import { signToken, verifyToken } from "../../supabase/functions/_shared/auth-token.js";

export const DISCORD_SESSION_COOKIE = "mchlern_discord_session";
export const DISCORD_STATE_COOKIE = "mchlern_discord_oauth_state";
export const DISCORD_ID_PATTERN = /^[0-9]{17,20}$/;

export function hasStrongSecret(value) {
  return typeof value === "string"
    && value.trim().length > 0
    && new TextEncoder().encode(value).length >= 32;
}

function readCookie(request, name) {
  const cookieHeader = request.headers.get("Cookie") ?? "";
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === name) {
      return part.slice(separator + 1).trim();
    }
  }
  return null;
}

function cookieHeader(name, value, request, maxAge) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

export function appendSessionCookie(headers, token, request) {
  headers.append("Set-Cookie", cookieHeader(DISCORD_SESSION_COOKIE, token, request, 604800));
}

export function clearSessionCookie(headers, request) {
  headers.append("Set-Cookie", cookieHeader(DISCORD_SESSION_COOKIE, "", request, 0));
}

export function appendStateCookie(headers, state, request) {
  headers.append("Set-Cookie", cookieHeader(DISCORD_STATE_COOKIE, state, request, 600));
}

export function clearStateCookie(headers, request) {
  headers.append("Set-Cookie", cookieHeader(DISCORD_STATE_COOKIE, "", request, 0));
}

export function getStateCookie(request) {
  return readCookie(request, DISCORD_STATE_COOKIE);
}

export async function getDiscordSession(request, env) {
  const token = readCookie(request, DISCORD_SESSION_COOKIE);
  if (!token) return null;

  const payload = await verifyToken(token, env.DISCORD_SESSION_SECRET);
  if (
    payload?.iss !== "mchlern-discord-session"
    || typeof payload.sub !== "string"
    || !DISCORD_ID_PATTERN.test(payload.sub)
    || typeof payload.username !== "string"
    || typeof payload.displayName !== "string"
    || typeof payload.avatarUrl !== "string"
    || !Number.isInteger(payload.exp)
    || payload.exp <= Math.floor(Date.now() / 1000)
  ) {
    return null;
  }

  return {
    id: payload.sub,
    username: payload.username,
    displayName: payload.displayName,
    avatarUrl: payload.avatarUrl,
  };
}

export async function createEdgeAssertion(session, env) {
  if (!hasStrongSecret(env.AUTH_BRIDGE_SECRET)) {
    throw new Error("Cloudflare auth bridge secret is not configured.");
  }
  const now = Math.floor(Date.now() / 1000);
  return signToken({
    iss: "mchlern-cloudflare-pages",
    aud: "mchlern-supabase-edge",
    sub: session.id,
    iat: now,
    exp: now + 60,
  }, env.AUTH_BRIDGE_SECRET);
}

export function sameOriginError(request) {
  const origin = request.headers.get("Origin");
  if (!origin || origin !== new URL(request.url).origin) {
    return Response.json({ error: "Permintaan ditolak karena asal halaman tidak valid." }, {
      status: 403,
      headers: { "Cache-Control": "no-store" },
    });
  }
  return null;
}

export function jsonError(message, status = 500) {
  return Response.json({ error: message }, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}
