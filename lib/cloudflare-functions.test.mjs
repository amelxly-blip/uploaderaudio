import test from "node:test";
import assert from "node:assert/strict";
import { onRequestPost as proxyFunction } from "../functions/api/functions/[name].js";
import { signToken, verifyToken } from "../supabase/functions/_shared/auth-token.js";
import { DISCORD_SESSION_COOKIE } from "../functions/_shared/auth.js";

const sessionSecret = "test-cloudflare-session-secret-32-bytes";
const bridgeSecret = "test-cloudflare-bridge-secret-32-bytes";

function requestToProxy(name, {
  origin = "https://uploaderaudio.pages.dev",
  urlOrigin = "https://uploaderaudio.pages.dev",
  cookie,
  headers = {},
} = {}) {
  const requestHeaders = new Headers({
    Origin: origin,
    "Content-Type": "application/json",
    ...headers,
  });
  if (cookie) requestHeaders.set("Cookie", cookie);
  return new Request(`${urlOrigin}/api/functions/${name}`, {
    method: "POST",
    headers: requestHeaders,
    body: JSON.stringify({}),
  });
}

test("Pages proxy requires same-origin requests and an allowlisted function", async () => {
  const invalidOrigin = await proxyFunction({
    request: requestToProxy("roblox-status", { origin: "https://attacker.example" }),
    env: {},
    params: { name: "roblox-status" },
  });
  assert.equal(invalidOrigin.status, 403);

  const unknownFunction = await proxyFunction({
    request: requestToProxy("not-a-function"),
    env: {},
    params: { name: "not-a-function" },
  });
  assert.equal(unknownFunction.status, 404);

  const configureWithoutSession = await proxyFunction({
    request: requestToProxy("roblox-configure"),
    env: {},
    params: { name: "roblox-configure" },
  });
  assert.equal(configureWithoutSession.status, 401);

  const disconnectWithoutSession = await proxyFunction({
    request: requestToProxy("roblox-disconnect"),
    env: {},
    params: { name: "roblox-disconnect" },
  });
  assert.equal(disconnectWithoutSession.status, 401);
});

test("Pages proxy sends a short-lived bridge assertion without forwarding browser cookies", async () => {
  const now = Math.floor(Date.now() / 1000);
  const session = await signToken({
    iss: "mchlern-discord-session",
    sub: "123456789012345678",
    username: "audio-user",
    displayName: "Audio User",
    avatarUrl: "",
    exp: now + 3600,
  }, sessionSecret);
  const env = {
    DISCORD_SESSION_SECRET: sessionSecret,
    AUTH_BRIDGE_SECRET: bridgeSecret,
    DISCORD_REDIRECT_URI: "https://uploaderaudio.pages.dev/api/auth/discord/callback",
    SUPABASE_URL: "https://example.supabase.co/",
    SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
  };
  const originalFetch = globalThis.fetch;
  let upstreamRequest;
  globalThis.fetch = async (input, init) => {
    upstreamRequest = { url: String(input), init };
    return new Response('{"authorized":true}', {
      status: 200,
      headers: { "Content-Type": "application/json", "Set-Cookie": "private=value" },
    });
  };

  try {
    const response = await proxyFunction({
      request: requestToProxy("roblox-status", {
        cookie: `${DISCORD_SESSION_COOKIE}=${session}`,
        headers: {
          "X-Untrusted-Header": "not-forwarded",
          "X-Asset-Type": "Decal",
        },
      }),
      env,
      params: { name: "roblox-status" },
    });

    assert.equal(response.status, 200);
    assert.equal(response.headers.has("Set-Cookie"), false);
    assert.equal(upstreamRequest.url, "https://example.supabase.co/functions/v1/roblox-status");
    assert.equal(upstreamRequest.init.headers.get("apikey"), "sb_publishable_test");
    assert.equal(upstreamRequest.init.headers.has("Cookie"), false);
    assert.equal(upstreamRequest.init.headers.has("X-Untrusted-Header"), false);
    assert.equal(upstreamRequest.init.headers.get("X-Asset-Type"), "Decal");
    assert.equal(upstreamRequest.init.headers.get("Origin"), "https://uploaderaudio.pages.dev");

    const assertion = upstreamRequest.init.headers.get("Authorization").replace(/^Bearer /, "");
    const claims = await verifyToken(assertion, bridgeSecret);
    assert.equal(claims.sub, "123456789012345678");
    assert.ok(claims.exp - claims.iat <= 60);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Pages proxy uses the configured app origin for Supabase when called from a preview", async () => {
  const now = Math.floor(Date.now() / 1000);
  const session = await signToken({
    iss: "mchlern-discord-session",
    sub: "123456789012345678",
    username: "audio-user",
    displayName: "Audio User",
    avatarUrl: "",
    exp: now + 3600,
  }, sessionSecret);
  const env = {
    DISCORD_SESSION_SECRET: sessionSecret,
    AUTH_BRIDGE_SECRET: bridgeSecret,
    DISCORD_REDIRECT_URI: "https://uploaderaudio.pages.dev/api/auth/discord/callback",
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
  };
  const previewOrigin = "https://preview-branch.uploaderaudio.pages.dev";
  const originalFetch = globalThis.fetch;
  let upstreamOrigin;
  globalThis.fetch = async (_input, init) => {
    upstreamOrigin = init.headers.get("Origin");
    if (upstreamOrigin !== "https://uploaderaudio.pages.dev") {
      return Response.json({ error: "Permintaan ditolak karena asal halaman tidak valid." }, { status: 403 });
    }
    return Response.json({ configured: true });
  };

  try {
    const response = await proxyFunction({
      request: requestToProxy("roblox-configure", {
        origin: previewOrigin,
        urlOrigin: previewOrigin,
        cookie: `${DISCORD_SESSION_COOKIE}=${session}`,
      }),
      env,
      params: { name: "roblox-configure" },
    });

    assert.equal(response.status, 200);
    assert.equal(upstreamOrigin, "https://uploaderaudio.pages.dev");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
