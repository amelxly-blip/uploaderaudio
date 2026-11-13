import { signToken } from "../../../supabase/functions/_shared/auth-token.js";
import {
  appendAdminSessionCookie,
  createAdminEdgeAssertion,
  hasStrongSecret,
  jsonError,
  sameOriginError,
} from "../../_shared/auth.js";

async function matchesPassword(candidate, expected) {
  const encoder = new TextEncoder();
  const [candidateHash, expectedHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(candidate)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  const candidateBytes = new Uint8Array(candidateHash);
  const expectedBytes = new Uint8Array(expectedHash);
  let difference = 0;
  for (let index = 0; index < expectedBytes.length; index += 1) {
    difference |= candidateBytes[index] ^ expectedBytes[index];
  }
  return difference === 0;
}

async function updateLoginLimit(request, env, addressHash, reset = false) {
  const supabaseUrl = env.SUPABASE_URL?.trim().replace(/\/+$/, "");
  const publishableKey = env.SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!supabaseUrl || !publishableKey || !hasStrongSecret(env.AUTH_BRIDGE_SECRET)) {
    throw new Error("Admin login rate limit is not configured.");
  }

  let endpoint;
  try {
    endpoint = new URL(`${supabaseUrl}/functions/v1/site-admin`);
    if (endpoint.protocol !== "https:") throw new Error("Supabase URL must use HTTPS.");
  } catch {
    throw new Error("Supabase URL is invalid.");
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${await createAdminEdgeAssertion(env)}`,
      "apikey": publishableKey,
      "Content-Type": "application/json",
      "Origin": new URL(request.url).origin,
    },
    body: JSON.stringify({ action: "login_attempt", addressHash, reset }),
    redirect: "manual",
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || typeof data?.allowed !== "boolean") {
    throw new Error("Admin login rate limit could not be verified.");
  }
  return data.allowed;
}

async function hashAddress(address) {
  const value = typeof address === "string" && address.length <= 64 ? address : "unknown";
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function readLoginBody(request) {
  const declaredLength = request.headers.get("Content-Length");
  if (
    declaredLength
    && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > 2048)
  ) {
    return { error: "Permintaan terlalu besar.", status: 413 };
  }
  if (!request.body) return { error: "Permintaan tidak valid.", status: 400 };

  const reader = request.body.getReader();
  const chunks = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > 2048) {
      await reader.cancel();
      return { error: "Permintaan terlalu besar.", status: 413 };
    }
    chunks.push(value);
  }
  if (length === 0) return { error: "Permintaan tidak valid.", status: 400 };

  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return { body: JSON.parse(text) };
  } catch {
    return { error: "Format permintaan tidak valid.", status: 400 };
  }
}

export async function onRequestPost({ request, env }) {
  const originError = sameOriginError(request);
  if (originError) return originError;

  if (!hasStrongSecret(env.ADMIN_PANEL_PASSWORD)) {
    return jsonError("Admin belum dikonfigurasi. Atur secret ADMIN_PANEL_PASSWORD di Cloudflare.", 503);
  }

  const parsed = await readLoginBody(request);
  if (parsed.error) return jsonError(parsed.error, parsed.status);
  const body = parsed.body;
  if (!body || typeof body.password !== "string" || body.password.length > 1024) {
    return jsonError("Password admin tidak valid.", 400);
  }

  let addressHash;
  try {
    addressHash = await hashAddress(request.headers.get("CF-Connecting-IP"));
    if (!await updateLoginLimit(request, env, addressHash)) {
      return jsonError("Terlalu banyak percobaan login. Tunggu 15 menit lalu coba lagi.", 429);
    }
  } catch (error) {
    console.error("Admin login rate limit check failed.", error);
    return jsonError("Proteksi login admin sementara tidak tersedia.", 503);
  }

  if (!await matchesPassword(body.password, env.ADMIN_PANEL_PASSWORD)) {
    return jsonError("Password admin salah.", 401);
  }

  try {
    await updateLoginLimit(request, env, addressHash, true);
  } catch (error) {
    console.error("Admin login rate limit reset failed.", error);
    return jsonError("Login berhasil diverifikasi, tetapi sesi belum bisa dibuat. Coba lagi.", 503);
  }

  const now = Math.floor(Date.now() / 1000);
  const token = await signToken({
    iss: "mchlern-admin-session",
    sub: "site-admin",
    iat: now,
    exp: now + 7200,
  }, env.ADMIN_PANEL_PASSWORD);
  const headers = new Headers({ "Cache-Control": "no-store" });
  appendAdminSessionCookie(headers, token, request);
  return Response.json({ authenticated: true }, { headers });
}
