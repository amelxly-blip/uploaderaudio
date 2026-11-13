import test from "node:test";
import assert from "node:assert/strict";
import { onRequestPost } from "../functions/api/admin/login.js";
import { ADMIN_SESSION_COOKIE, getAdminSession } from "../functions/_shared/auth.js";
import { verifyToken } from "../supabase/functions/_shared/auth-token.js";

const adminPassword = "test-admin-panel-password-with-at-least-32-bytes";
const bridgeSecret = "test-cloudflare-bridge-secret-32-bytes";
const env = {
  ADMIN_PANEL_PASSWORD: adminPassword,
  AUTH_BRIDGE_SECRET: bridgeSecret,
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
};

function loginRequest(password) {
  return new Request("https://uploaderaudio.pages.dev/api/admin/login", {
    method: "POST",
    headers: {
      Origin: "https://uploaderaudio.pages.dev",
      "Content-Type": "application/json",
      "CF-Connecting-IP": "198.51.100.55",
    },
    body: JSON.stringify({ password }),
  });
}

test("admin login rate-limits using a hashed IP and issues an HttpOnly session", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url: String(input), body, headers: new Headers(init.headers) });
    return Response.json({ allowed: true });
  };

  try {
    const response = await onRequestPost({
      request: loginRequest(adminPassword),
      env,
    });
    assert.equal(response.status, 200);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].url, "https://example.supabase.co/functions/v1/site-admin");
    assert.match(calls[0].body.addressHash, /^[0-9a-f]{64}$/);
    assert.equal(JSON.stringify(calls).includes("198.51.100.55"), false);
    assert.equal(JSON.stringify(calls).includes(adminPassword), false);
    assert.equal(calls[1].body.reset, true);

    const cookie = response.headers.get("Set-Cookie");
    assert.match(cookie, new RegExp(`^${ADMIN_SESSION_COOKIE}=`));
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Strict/);
    const token = cookie.match(/^[^=]+=([^;]+)/)[1];
    assert.equal(await getAdminSession(new Request("https://uploaderaudio.pages.dev/api/admin/session", {
      headers: { Cookie: `${ADMIN_SESSION_COOKIE}=${token}` },
    }), env), true);

    const assertion = calls[0].headers.get("Authorization").replace(/^Bearer /, "");
    const claims = await verifyToken(assertion, bridgeSecret);
    assert.equal(claims.aud, "mchlern-supabase-admin");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("admin login rejects incorrect passwords and denies a locked address", async () => {
  const originalFetch = globalThis.fetch;
  let allowed = true;
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(init.body);
    return Response.json({ allowed: body.reset ? true : allowed });
  };

  try {
    const incorrect = await onRequestPost({ request: loginRequest("wrong"), env });
    assert.equal(incorrect.status, 401);

    allowed = false;
    const limited = await onRequestPost({ request: loginRequest(adminPassword), env });
    assert.equal(limited.status, 429);
    assert.equal(limited.headers.has("Set-Cookie"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
