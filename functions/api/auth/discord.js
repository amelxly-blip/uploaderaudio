import {
  appendStateCookie,
  hasStrongSecret,
  jsonError,
} from "../../_shared/auth.js";

function randomState() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export async function onRequestGet({ request, env }) {
  const clientId = env.DISCORD_CLIENT_ID?.trim();
  const clientSecret = env.DISCORD_CLIENT_SECRET?.trim();
  const redirectUri = env.DISCORD_REDIRECT_URI?.trim();
  if (
    !clientId
    || !redirectUri
    || !clientSecret
    || !hasStrongSecret(env.DISCORD_SESSION_SECRET)
  ) {
    return jsonError("Login Discord belum dikonfigurasi di Cloudflare.", 503);
  }

  let callback;
  try {
    callback = new URL(redirectUri);
  } catch {
    return jsonError("URL callback Discord di Cloudflare tidak valid.", 503);
  }
  if (
    callback.protocol !== "https:"
    || callback.pathname !== "/api/auth/discord/callback"
    || callback.search
    || callback.hash
    || callback.username
    || callback.password
    || callback.origin !== new URL(request.url).origin
  ) {
    return jsonError("URL callback Discord harus HTTPS dan sesuai domain Cloudflare Pages.", 503);
  }

  const state = randomState();
  const authorizeUrl = new URL("https://discord.com/oauth2/authorize");
  authorizeUrl.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "identify",
    state,
  }).toString();

  const headers = new Headers({
    Location: authorizeUrl.toString(),
    "Cache-Control": "no-store",
  });
  appendStateCookie(headers, state, request);
  return new Response(null, { status: 302, headers });
}
