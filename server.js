import "dotenv/config";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import express from "express";
import multer from "multer";
import { fileTypeFromBuffer } from "file-type";
import { parseBuffer } from "music-metadata";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const MAX_FILE_SIZE = 20 * 1024 * 1024;
const MAX_DURATION_SECONDS = 7 * 60;
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const OAUTH_STATE_TTL_MS = 5 * 60 * 1000;
const OPERATION_TTL_MS = 10 * 60 * 1000;
const UPLOADS_PER_HOUR = 10;
const AUDIO_TYPES = new Map([
  [".mp3", new Set(["audio/mpeg"])],
  [".ogg", new Set(["audio/ogg"])],
  [".wav", new Set(["audio/wav", "audio/vnd.wave"])],
  [".flac", new Set(["audio/flac", "audio/x-flac"])],
]);

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function readConfig(env = process.env) {
  const creatorType = env.ROBLOX_CREATOR_TYPE?.trim().toLowerCase();
  const creatorId = env.ROBLOX_CREATOR_ID?.trim();
  const creatorValid = ["user", "group"].includes(creatorType)
    && /^\d+$/.test(creatorId || "")
    && Number.isSafeInteger(Number(creatorId))
    && Number(creatorId) > 0;
  return {
    nodeEnv: env.NODE_ENV || "development",
    port: Number(env.PORT) || 3000,
    publicOrigin: env.PUBLIC_ORIGIN || "",
    discordClientId: env.DISCORD_CLIENT_ID || "",
    discordClientSecret: env.DISCORD_CLIENT_SECRET || "",
    discordRedirectUri: env.DISCORD_REDIRECT_URI || "",
    allowedDiscordUserIds: new Set(
      (env.DISCORD_ALLOWED_USER_IDS || "")
        .split(",")
        .map((id) => id.trim())
        .filter((id) => /^\d+$/.test(id)),
    ),
    robloxApiKey: env.ROBLOX_OPEN_CLOUD_API_KEY || "",
    creatorType: creatorValid ? creatorType : "",
    creatorId: creatorValid ? creatorId : "",
    get discordConfigured() {
      return Boolean(this.discordClientId && this.discordClientSecret && this.discordRedirectUri);
    },
    get robloxConfigured() {
      return Boolean(this.robloxApiKey && this.creatorType && this.creatorId);
    },
    get creatorLabel() {
      if (!this.robloxConfigured) return "";
      return `${this.creatorType === "group" ? "Group" : "User"} · ${this.creatorId}`;
    },
  };
}

function readCookie(header, name) {
  for (const part of (header || "").split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return "";
    }
  }
  return "";
}

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function safeRobloxError(status) {
  if (status === 401 || status === 403) {
    return new HttpError(502, "Roblox menolak akses. Periksa izin API key dan creator yang diizinkan.");
  }
  if (status === 429) {
    return new HttpError(429, "Kuota atau batas permintaan Roblox tercapai. Coba lagi setelah kuota tersedia.");
  }
  if (status === 400 || status === 413 || status === 415) {
    return new HttpError(422, "Roblox menolak file atau detail asset. Periksa format dan panduan audio Roblox.");
  }
  return new HttpError(502, "Roblox belum menyelesaikan permintaan. Periksa status di Creator Dashboard.");
}

async function validateAudioFile(file) {
  if (!file?.buffer || !Buffer.isBuffer(file.buffer)) {
    throw new HttpError(400, "Pilih file audio sebelum upload.");
  }
  if (file.buffer.length === 0) throw new HttpError(400, "File audio kosong.");
  if (file.buffer.length > MAX_FILE_SIZE) {
    throw new HttpError(413, "Ukuran file maksimal 20 MB.");
  }

  const extension = path.extname(path.win32.basename(file.originalname || "")).toLowerCase();
  const allowedMimes = AUDIO_TYPES.get(extension);
  if (!allowedMimes) {
    throw new HttpError(415, "Format audio yang didukung: MP3, OGG, WAV, dan FLAC.");
  }
  const detected = await fileTypeFromBuffer(file.buffer);
  if (!detected || !allowedMimes.has(detected.mime)) {
    throw new HttpError(415, "Isi file tidak cocok dengan format audio yang dipilih.");
  }

  let metadata;
  try {
    metadata = await parseBuffer(file.buffer, { mimeType: detected.mime }, { duration: true });
  } catch {
    throw new HttpError(422, "File audio tidak bisa dibaca. Ekspor ulang sebagai MP3, OGG, WAV, atau FLAC.");
  }
  const duration = metadata.format.duration;
  if (!Number.isFinite(duration)) {
    throw new HttpError(422, "Durasi audio tidak bisa diverifikasi. Coba ekspor ulang file.");
  }
  if (duration > MAX_DURATION_SECONDS) {
    throw new HttpError(422, "Durasi audio maksimal 7 menit.");
  }
  return { mime: detected.mime, duration, extension };
}

function makeUser(raw) {
  if (!raw || typeof raw.id !== "string" || !/^\d+$/.test(raw.id) || typeof raw.username !== "string") {
    throw new HttpError(502, "Discord tidak mengembalikan profil yang valid.");
  }
  const displayName = typeof raw.global_name === "string" && raw.global_name.trim()
    ? raw.global_name.trim()
    : raw.username;
  const avatarUrl = raw.avatar
    ? `https://cdn.discordapp.com/avatars/${encodeURIComponent(raw.id)}/${encodeURIComponent(raw.avatar)}.png?size=96`
    : "";
  return { id: raw.id, username: raw.username, displayName, avatarUrl };
}

function makeDiscordAuthorizationUrl(config, state) {
  const url = new URL("https://discord.com/oauth2/authorize");
  url.searchParams.set("client_id", config.discordClientId);
  url.searchParams.set("redirect_uri", config.discordRedirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "identify");
  url.searchParams.set("state", state);
  return url;
}

function setSessionCookie(res, token, config) {
  const secure = config.nodeEnv === "production" ? "; Secure" : "";
  res.setHeader("Set-Cookie", `mchlern_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_MS / 1000}${secure}`);
}

function clearSessionCookie(res, config) {
  const secure = config.nodeEnv === "production" ? "; Secure" : "";
  res.setHeader("Set-Cookie", `mchlern_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`);
}

function createApp(options = {}) {
  const config = options.config || readConfig();
  const fetchImpl = options.fetchImpl || fetch;
  const sessions = new Map();
  const oauthStates = new Map();
  const operations = new Map();
  const uploadTimes = new Map();
  let activeUploads = 0;

  const app = express();
  if (config.nodeEnv === "production") app.set("trust proxy", 1);
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://cdn.discordapp.com; media-src 'self' blob:; connect-src 'self'; base-uri 'self'; form-action 'self' https://discord.com; frame-ancestors 'none'",
    );
    next();
  });
  app.use(express.json({ limit: "8kb" }));

  const authenticate = (req, res, next) => {
    const token = readCookie(req.headers.cookie, "mchlern_session");
    const session = sessions.get(token);
    if (!session || session.expiresAt <= Date.now()) {
      if (session) sessions.delete(token);
      return res.status(401).json({ error: "Masuk dengan Discord untuk melanjutkan." });
    }
    req.authUser = session.user;
    return next();
  };

  const authorize = (req, res, next) => {
    if (!config.allowedDiscordUserIds.has(req.authUser.id)) {
      return res.status(403).json({ error: "Akun Discord ini belum diizinkan untuk menggunakan uploader." });
    }
    return next();
  };

  const sameOrigin = (req, res, next) => {
    const origin = req.get("origin");
    const expectedOrigin = config.publicOrigin || `${req.protocol}://${req.get("host")}`;
    if (!origin || origin !== expectedOrigin) {
      return res.status(403).json({ error: "Permintaan ditolak karena asal halaman tidak valid." });
    }
    return next();
  };

  const uploadLimiter = (req, res, next) => {
    if (activeUploads >= 3) {
      return res.status(503).json({ error: "Server sedang menangani upload lain. Coba lagi sebentar." });
    }
    const now = Date.now();
    const recent = (uploadTimes.get(req.authUser.id) || []).filter((time) => now - time < 60 * 60 * 1000);
    if (recent.length >= UPLOADS_PER_HOUR) {
      return res.status(429).json({ error: "Batas upload aplikasi per jam tercapai. Coba lagi nanti." });
    }
    req.recentUploadTimes = recent;
    activeUploads += 1;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      activeUploads = Math.max(0, activeUploads - 1);
    };
    res.once("finish", release);
    res.once("close", release);
    return next();
  };

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_FILE_SIZE, files: 1, fields: 1, fieldSize: 200 },
  });

  app.get("/", (_req, res) => res.sendFile(path.join(ROOT, "index.html")));

  app.get("/auth/discord", (req, res) => {
    if (!config.discordConfigured) return res.redirect("/?login=unavailable");
    for (const [state, expiresAt] of oauthStates) {
      if (expiresAt <= Date.now()) oauthStates.delete(state);
    }
    const state = crypto.randomBytes(24).toString("base64url");
    oauthStates.set(state, Date.now() + OAUTH_STATE_TTL_MS);
    return res.redirect(302, makeDiscordAuthorizationUrl(config, state).toString());
  });

  app.get("/auth/callback", asyncRoute(async (req, res) => {
    const { code, state, error } = req.query;
    const expiresAt = oauthStates.get(state);
    oauthStates.delete(state);
    if (error || typeof state !== "string" || !expiresAt || expiresAt <= Date.now() || typeof code !== "string") {
      return res.redirect("/?login=failed");
    }
    const tokenResponse = await fetchImpl("https://discord.com/api/v10/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: config.discordClientId,
        client_secret: config.discordClientSecret,
        grant_type: "authorization_code",
        code,
        redirect_uri: config.discordRedirectUri,
      }),
      signal: AbortSignal.timeout(10000),
    }).catch(() => { throw new HttpError(502, "Discord tidak merespons. Coba login lagi."); });
    if (!tokenResponse.ok) return res.redirect("/?login=failed");
    const tokenData = await tokenResponse.json().catch(() => null);
    if (!tokenData || typeof tokenData.access_token !== "string") {
      return res.redirect("/?login=failed");
    }
    const profileResponse = await fetchImpl("https://discord.com/api/v10/users/@me", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
      signal: AbortSignal.timeout(10000),
    }).catch(() => { throw new HttpError(502, "Discord tidak merespons. Coba login lagi."); });
    if (!profileResponse.ok) return res.redirect("/?login=failed");
    const rawUser = await profileResponse.json().catch(() => null);
    const user = makeUser(rawUser);
    const sessionToken = crypto.randomBytes(32).toString("base64url");
    sessions.set(sessionToken, { user, expiresAt: Date.now() + SESSION_TTL_MS });
    setSessionCookie(res, sessionToken, config);
    return res.redirect("/");
  }));

  app.get("/api/auth/me", (req, res) => {
    const token = readCookie(req.headers.cookie, "mchlern_session");
    const session = sessions.get(token);
    if (!session || session.expiresAt <= Date.now()) {
      if (session) sessions.delete(token);
      return res.json({
        authenticated: false,
        authorized: false,
        discordConfigured: config.discordConfigured,
        robloxConfigured: config.robloxConfigured,
        apiKeyConfigured: Boolean(config.robloxApiKey),
        creatorLabel: config.creatorLabel,
      });
    }
    return res.json({
      authenticated: true,
      authorized: config.allowedDiscordUserIds.has(session.user.id),
      discordUser: session.user,
      discordConfigured: config.discordConfigured,
      robloxConfigured: config.robloxConfigured,
      apiKeyConfigured: Boolean(config.robloxApiKey),
      creatorLabel: config.creatorLabel,
    });
  });

  app.post("/api/auth/logout", sameOrigin, authenticate, (req, res) => {
    const token = readCookie(req.headers.cookie, "mchlern_session");
    sessions.delete(token);
    clearSessionCookie(res, config);
    return res.json({ ok: true });
  });

  app.post(
    "/api/uploads",
    authenticate,
    authorize,
    sameOrigin,
    (req, res, next) => {
      if (!config.robloxConfigured) {
        return res.status(503).json({ error: "Open Cloud belum dikonfigurasi di server." });
      }
      return uploadLimiter(req, res, next);
    },
    upload.single("audio"),
    asyncRoute(async (req, res) => {
      const file = req.file;
      const audioInfo = await validateAudioFile(file);
      const displayName = typeof req.body.displayName === "string" ? req.body.displayName.trim() : "";
      if (!displayName || displayName.length > 50 || /[\u0000-\u001f\u007f]/.test(displayName)) {
        throw new HttpError(400, "Nama asset wajib diisi dan maksimal 50 karakter.");
      }
      const creator = config.creatorType === "group"
        ? { groupId: Number(config.creatorId) }
        : { userId: Number(config.creatorId) };
      const request = {
        assetType: "Audio",
        displayName,
        description: "Audio uploaded through Roblox Open Cloud.",
        creationContext: { creator },
      };
      const form = new FormData();
      form.append("request", JSON.stringify(request));
      form.append(
        "fileContent",
        new Blob([file.buffer], { type: audioInfo.mime }),
        path.win32.basename(file.originalname),
      );
      req.recentUploadTimes.push(Date.now());
      uploadTimes.set(req.authUser.id, req.recentUploadTimes);

      const createResponse = await fetchImpl("https://apis.roblox.com/assets/v1/assets", {
        method: "POST",
        headers: { "x-api-key": config.robloxApiKey },
        body: form,
        signal: AbortSignal.timeout(30000),
      }).catch(() => { throw new HttpError(502, "Roblox tidak merespons. Coba lagi setelah koneksi pulih."); });
      if (!createResponse.ok) throw safeRobloxError(createResponse.status);
      const created = await createResponse.json().catch(() => null);
      const operationPath = created?.path;
      if (typeof operationPath !== "string" || !/^operations\/[A-Za-z0-9._-]+$/.test(operationPath)) {
        throw new HttpError(502, "Roblox tidak mengembalikan status operasi yang valid.");
      }
      const operationId = operationPath.slice("operations/".length);
      const operation = { path: operationPath, userId: req.authUser.id, expiresAt: Date.now() + OPERATION_TTL_MS, result: null };
      operations.set(operationId, operation);
      return res.status(202).json({ status: "processing", operationId });
    }),
  );

  app.get("/api/uploads/:operationId", authenticate, authorize, asyncRoute(async (req, res) => {
    for (const [id, operation] of operations) {
      if (operation.expiresAt <= Date.now()) operations.delete(id);
    }
    const { operationId } = req.params;
    if (!/^[A-Za-z0-9._-]+$/.test(operationId)) {
      throw new HttpError(400, "ID operasi tidak valid.");
    }
    const operation = operations.get(operationId);
    if (!operation || operation.userId !== req.authUser.id) {
      throw new HttpError(404, "Status upload tidak ditemukan.");
    }
    if (operation.result) return res.json(operation.result);

    const operationResponse = await fetchImpl(`https://apis.roblox.com/assets/v1/${operation.path}`, {
      headers: { "x-api-key": config.robloxApiKey },
      signal: AbortSignal.timeout(10000),
    }).catch(() => { throw new HttpError(502, "Roblox tidak merespons saat memeriksa upload."); });
    if (!operationResponse.ok) throw safeRobloxError(operationResponse.status);
    const status = await operationResponse.json().catch(() => null);
    if (!status || status.done !== true) return res.json({ status: "processing" });
    if (status.response?.assetId && /^\d+$/.test(String(status.response.assetId))) {
      operation.result = { status: "completed", assetId: String(status.response.assetId) };
      return res.json(operation.result);
    }
    operation.result = {
      status: "failed",
      error: "Roblox menolak upload ini. Periksa izin API key, kuota, dan status moderasi di Creator Dashboard.",
    };
    return res.json(operation.result);
  }));

  app.use((req, res) => res.status(404).json({ error: "Halaman atau endpoint tidak ditemukan." }));

  app.use((error, _req, res, _next) => {
    if (res.headersSent) return;
    if (error instanceof multer.MulterError) {
      const status = error.code === "LIMIT_FILE_SIZE" ? 413 : 400;
      const message = error.code === "LIMIT_FILE_SIZE"
        ? "Ukuran file maksimal 20 MB."
        : "Permintaan file tidak valid. Kirim satu file audio.";
      return res.status(status).json({ error: message });
    }
    if (error instanceof HttpError) return res.status(error.status).json({ error: error.message });
    return res.status(500).json({ error: "Terjadi kesalahan server. Coba lagi nanti." });
  });

  return app;
}

const app = createApp();
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const config = readConfig();
  app.listen(config.port, () => {
    process.stdout.write(`MCHLERN Audio workspace listening on port ${config.port}\n`);
  });
}

export { createApp, readConfig, validateAudioFile };
