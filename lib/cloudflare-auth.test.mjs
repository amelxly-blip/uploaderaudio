import test from "node:test";
import assert from "node:assert/strict";
import { signToken } from "../supabase/functions/_shared/auth-token.js";
import {
  ADMIN_SESSION_COOKIE,
  createAdminEdgeAssertion,
  createEdgeAssertion,
  DISCORD_SESSION_COOKIE,
  getAdminSession,
  getDiscordSession,
} from "../functions/_shared/auth.js";

const secret = "test-cloudflare-session-secret-32-bytes";
const now = Math.floor(Date.now() / 1000);

function requestWithSession(token) {
  return new Request("https://uploaderaudio.pages.dev/api/auth/session", {
    headers: { Cookie: `${DISCORD_SESSION_COOKIE}=${token}` },
  });
}

test("Discord session accepts a valid signed profile and rejects expired or malformed identities", async () => {
  const validToken = await signToken({
    iss: "mchlern-discord-session",
    sub: "123456789012345678",
    username: "audio-user",
    displayName: "Audio User",
    avatarUrl: "",
    iat: now,
    exp: now + 3600,
  }, secret);

  assert.deepEqual(await getDiscordSession(requestWithSession(validToken), {
    DISCORD_SESSION_SECRET: secret,
  }), {
    id: "123456789012345678",
    username: "audio-user",
    displayName: "Audio User",
    avatarUrl: "",
  });

  const expiredToken = await signToken({
    iss: "mchlern-discord-session",
    sub: "123456789012345678",
    username: "audio-user",
    displayName: "Audio User",
    avatarUrl: "",
    exp: now - 1,
  }, secret);
  assert.equal(await getDiscordSession(requestWithSession(expiredToken), {
    DISCORD_SESSION_SECRET: secret,
  }), null);

  const malformedToken = await signToken({
    iss: "mchlern-discord-session",
    sub: "not-a-discord-id",
    username: "audio-user",
    displayName: "Audio User",
    avatarUrl: "",
    exp: now + 3600,
  }, secret);
  assert.equal(await getDiscordSession(requestWithSession(malformedToken), {
    DISCORD_SESSION_SECRET: secret,
  }), null);
});

test("Cloudflare bridge assertions identify the Discord user and expire within one minute", async () => {
  const token = await createEdgeAssertion({ id: "123456789012345678" }, {
    AUTH_BRIDGE_SECRET: secret,
  });
  const [encodedPayload] = token.split(".");
  const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));

  assert.equal(payload.iss, "mchlern-cloudflare-pages");
  assert.equal(payload.aud, "mchlern-supabase-edge");
  assert.equal(payload.sub, "123456789012345678");
  assert.ok(payload.exp - payload.iat <= 60);
  await assert.rejects(createEdgeAssertion({ id: "123456789012345678" }, {
    AUTH_BRIDGE_SECRET: "short",
  }));
});

test("admin sessions use a separate signed audience and a short-lived HttpOnly cookie", async () => {
  const adminPassword = "test-admin-panel-password-with-at-least-32-bytes";
  const token = await signToken({
    iss: "mchlern-admin-session",
    sub: "site-admin",
    iat: now,
    exp: now + 7200,
  }, adminPassword);
  const request = new Request("https://uploaderaudio.pages.dev/api/admin/session", {
    headers: { Cookie: `${ADMIN_SESSION_COOKIE}=${token}` },
  });
  const env = { ADMIN_PANEL_PASSWORD: adminPassword };

  assert.equal(await getAdminSession(request, env), true);
  assert.equal(await getAdminSession(request, { ADMIN_PANEL_PASSWORD: "wrong-secret" }), false);

  const assertion = await createAdminEdgeAssertion({ AUTH_BRIDGE_SECRET: secret });
  const [encodedPayload] = assertion.split(".");
  const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
  assert.equal(payload.iss, "mchlern-cloudflare-admin");
  assert.equal(payload.aud, "mchlern-supabase-admin");
  assert.equal(payload.sub, "site-admin");
  assert.ok(payload.exp - payload.iat <= 60);
});
