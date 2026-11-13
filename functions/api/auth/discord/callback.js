import { signToken } from "../../../../supabase/functions/_shared/auth-token.js";
import {
  appendSessionCookie,
  clearStateCookie,
  DISCORD_ID_PATTERN,
  getStateCookie,
  hasStrongSecret,
} from "../../../_shared/auth.js";

function redirectWithError(request, code) {
  const url = new URL("/", request.url);
  url.searchParams.set("discord_error", code);
  const headers = new Headers({
    Location: url.toString(),
    "Cache-Control": "no-store",
  });
  clearStateCookie(headers, request);
  return new Response(null, { status: 302, headers });
}

export async function onRequestGet({ request, env }) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const state = requestUrl.searchParams.get("state");
  const savedState = getStateCookie(request);
  const clientId = env.DISCORD_CLIENT_ID?.trim();
  const clientSecret = env.DISCORD_CLIENT_SECRET?.trim();
  const redirectUri = env.DISCORD_REDIRECT_URI?.trim();

  if (
    requestUrl.searchParams.has("error")
    || !code
    || !state
    || !savedState
    || state !== savedState
  ) {
    return redirectWithError(request, "denied");
  }
  if (
    !clientId
    || !clientSecret
    || !redirectUri
    || !hasStrongSecret(env.DISCORD_SESSION_SECRET)
  ) {
    return redirectWithError(request, "config");
  }

  try {
    const callback = new URL(redirectUri);
    if (
      callback.protocol !== "https:"
      || callback.origin !== requestUrl.origin
      || callback.pathname !== "/api/auth/discord/callback"
      || callback.username
      || callback.password
      || callback.search
      || callback.hash
    ) {
      return redirectWithError(request, "config");
    }

    const tokenResponse = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
      }),
    });
    if (!tokenResponse.ok) return redirectWithError(request, "token");

    const tokenData = await tokenResponse.json();
    if (typeof tokenData.access_token !== "string") {
      return redirectWithError(request, "token");
    }

    const userResponse = await fetch("https://discord.com/api/users/@me", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    if (!userResponse.ok) return redirectWithError(request, "user");

    const discordUser = await userResponse.json();
    if (
      typeof discordUser.id !== "string"
      || !DISCORD_ID_PATTERN.test(discordUser.id)
      || typeof discordUser.username !== "string"
    ) {
      return redirectWithError(request, "user");
    }

    const avatarUrl = typeof discordUser.avatar === "string"
      ? `https://cdn.discordapp.com/avatars/${discordUser.id}/${discordUser.avatar}.png?size=128`
      : "";
    const now = Math.floor(Date.now() / 1000);
    const sessionToken = await signToken({
      iss: "mchlern-discord-session",
      sub: discordUser.id,
      username: discordUser.username.slice(0, 100),
      displayName: (discordUser.global_name || discordUser.username).slice(0, 100),
      avatarUrl,
      iat: now,
      exp: now + 7 * 24 * 60 * 60,
    }, env.DISCORD_SESSION_SECRET);

    const headers = new Headers({
      Location: requestUrl.origin,
      "Cache-Control": "no-store",
    });
    appendSessionCookie(headers, sessionToken, request);
    clearStateCookie(headers, request);
    return new Response(null, { status: 302, headers });
  } catch (error) {
    console.error("Discord OAuth callback failed.", error);
    return redirectWithError(request, "server");
  }
}
