import test from "node:test";
import assert from "node:assert/strict";
import { onRequestPost } from "../functions/api/admin/functions/[name].js";
import { ADMIN_SESSION_COOKIE } from "../functions/_shared/auth.js";
import { signToken, verifyToken } from "../supabase/functions/_shared/auth-token.js";

const adminPassword = "test-admin-panel-password-with-at-least-32-bytes";
const bridgeSecret = "test-cloudflare-bridge-secret-32-bytes";

async function adminCookie() {
  const now = Math.floor(Date.now() / 1000);
  const token = await signToken({
    iss: "mchlern-admin-session",
    sub: "site-admin",
    iat: now,
    exp: now + 3600,
  }, adminPassword);
  return `${ADMIN_SESSION_COOKIE}=${token}`;
}

function requestToAdminProxy(
  cookie,
  origin = "https://uploaderaudio.pages.dev",
  urlOrigin = "https://uploaderaudio.pages.dev",
) {
  return new Request(`${urlOrigin}/api/admin/functions/site-admin`, {
    method: "POST",
    headers: {
      Origin: origin,
      Cookie: cookie,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ action: "overview" }),
  });
}

test("admin API proxy requires same-origin and an authenticated admin session", async () => {
  const env = {
    ADMIN_PANEL_PASSWORD: adminPassword,
    AUTH_BRIDGE_SECRET: bridgeSecret,
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
  };
  const unauthorized = await onRequestPost({
    request: requestToAdminProxy(""),
    env,
    params: { name: "site-admin" },
  });
  assert.equal(unauthorized.status, 401);

  const invalidOrigin = await onRequestPost({
    request: requestToAdminProxy(await adminCookie(), "https://attacker.example"),
    env,
    params: { name: "site-admin" },
  });
  assert.equal(invalidOrigin.status, 403);
});

test("admin API proxy sends only a short-lived signed assertion upstream", async () => {
  const originalFetch = globalThis.fetch;
  let upstream;
  globalThis.fetch = async (input, init) => {
    upstream = { url: String(input), init };
    return Response.json({ totalVip: 3 });
  };

  try {
    const response = await onRequestPost({
      request: requestToAdminProxy(await adminCookie()),
      env: {
        ADMIN_PANEL_PASSWORD: adminPassword,
        AUTH_BRIDGE_SECRET: bridgeSecret,
        SUPABASE_URL: "https://example.supabase.co",
        SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
      },
      params: { name: "site-admin" },
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { totalVip: 3 });
    assert.equal(upstream.url, "https://example.supabase.co/functions/v1/site-admin");
    assert.equal(upstream.init.headers.get("apikey"), "sb_publishable_test");
    assert.equal(upstream.init.headers.has("Cookie"), false);
    const token = upstream.init.headers.get("Authorization").replace(/^Bearer /, "");
    const claims = await verifyToken(token, bridgeSecret);
    assert.equal(claims.aud, "mchlern-supabase-admin");
    assert.ok(claims.exp - claims.iat <= 60);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
