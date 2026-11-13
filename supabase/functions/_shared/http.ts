import { createClient } from "npm:@supabase/supabase-js@2.119.0";
import { verifyToken } from "./auth-token.js";

type Json = Record<string, unknown>;

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const allowedOrigins = new Set(
  (Deno.env.get("APP_ORIGINS") ?? "")
    .split(",")
    .map((origin) => origin.trim().replace(/\/+$/, ""))
    .filter(Boolean),
);

function defaultKey(name: string, fallbackName: string): string {
  const raw = Deno.env.get(name);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (typeof parsed.default === "string") return parsed.default;
    } catch {
      throw new Error(`${name} must be a JSON object with a default key.`);
    }
  }
  return Deno.env.get(fallbackName) ?? "";
}

const secretKey = defaultKey("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY");

if (!supabaseUrl || !secretKey) {
  throw new Error("Supabase URL and server secret key must be configured.");
}

export const adminClient = createClient(supabaseUrl, secretKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

export function responseHeaders(request: Request): Headers {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Vary": "Origin",
  });
  const origin = request.headers.get("Origin")?.replace(/\/+$/, "");
  if (origin && allowedOrigins.has(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Credentials", "true");
    headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    headers.set(
      "Access-Control-Allow-Headers",
      "authorization, apikey, content-type, x-client-info, x-audio-name, x-audio-filename",
    );
    headers.set("Access-Control-Max-Age", "86400");
  }
  return headers;
}

export function jsonResponse(request: Request, body: Json, status = 200): Response {
  return Response.json(body, { status, headers: responseHeaders(request) });
}

export function checkOrigin(request: Request): Response | null {
  const origin = request.headers.get("Origin")?.replace(/\/+$/, "");
  if (!origin || !allowedOrigins.has(origin)) {
    return jsonResponse(request, { error: "Permintaan ditolak karena asal halaman tidak valid." }, 403);
  }
  return null;
}

export function preflightResponse(request: Request): Response {
  const originError = checkOrigin(request);
  if (originError) return originError;
  return new Response(null, { status: 204, headers: responseHeaders(request) });
}

export interface AuthenticatedUser {
  id: string;
}

export async function authenticate(request: Request): Promise<{ user: AuthenticatedUser }> {
  const authorization = request.headers.get("Authorization");
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) throw new HttpResponseError(401, "Masuk dengan Discord untuk melanjutkan.");

  const bridgeSecret = Deno.env.get("AUTH_BRIDGE_SECRET");
  if (!bridgeSecret) throw new Error("Cloudflare auth bridge secret is not configured.");
  const claims = await verifyToken(token, bridgeSecret);
  const now = Math.floor(Date.now() / 1000);
  if (
    claims?.iss !== "mchlern-cloudflare-pages"
    || claims.aud !== "mchlern-supabase-edge"
    || typeof claims.sub !== "string"
    || !/^[0-9]{17,20}$/.test(claims.sub)
    || !Number.isInteger(claims.iat)
    || !Number.isInteger(claims.exp)
    || claims.iat > now + 5
    || claims.exp <= now
    || claims.exp - claims.iat > 60
  ) {
    throw new HttpResponseError(401, "Sesi Discord tidak valid. Masuk lagi.");
  }
  return { user: { id: claims.sub } };
}

export class HttpResponseError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function errorResponse(request: Request, error: unknown): Response {
  if (error instanceof HttpResponseError) {
    return jsonResponse(request, { error: error.message }, error.status);
  }
  return jsonResponse(request, { error: "Terjadi kesalahan server. Coba lagi nanti." }, 500);
}

export function decodeHeader(value: string | null, label: string, maximumLength: number): string {
  if (!value) throw new HttpResponseError(400, `${label} wajib diisi.`);
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    throw new HttpResponseError(400, `${label} tidak valid.`);
  }
  const normalized = decoded.trim();
  if (!normalized || normalized.length > maximumLength || /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new HttpResponseError(400, `${label} tidak valid.`);
  }
  return normalized;
}

export async function readBoundedBody(
  request: Request,
  maximumBytes: number,
  messages: { tooLarge: string; empty: string } = {
    tooLarge: "Ukuran file maksimal 20 MB.",
    empty: "Pilih file audio sebelum upload.",
  },
): Promise<Uint8Array> {
  const declaredLength = request.headers.get("Content-Length");
  if (declaredLength && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > maximumBytes)) {
    throw new HttpResponseError(413, messages.tooLarge);
  }
  if (!request.body) throw new HttpResponseError(400, messages.empty);

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > maximumBytes) {
      await reader.cancel();
      throw new HttpResponseError(413, messages.tooLarge);
    }
    chunks.push(value);
  }
  if (length === 0) throw new HttpResponseError(400, messages.empty);

  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

export function robloxError(status: number): HttpResponseError {
  if (status === 401 || status === 403) {
    return new HttpResponseError(502, "Roblox menolak akses. Periksa izin API key dan creator yang diizinkan.");
  }
  if (status === 429) {
    return new HttpResponseError(429, "Kuota atau batas permintaan Roblox tercapai. Coba lagi setelah kuota tersedia.");
  }
  if (status === 400 || status === 413 || status === 415) {
    return new HttpResponseError(422, "Roblox menolak file atau detail asset. Periksa format dan panduan audio.");
  }
  return new HttpResponseError(502, "Roblox belum menyelesaikan permintaan. Periksa Creator Dashboard.");
}

export function safeMessage(error: unknown): string {
  return error instanceof HttpResponseError
    ? error.message
    : "Roblox belum menyelesaikan permintaan. Periksa Creator Dashboard.";
}
