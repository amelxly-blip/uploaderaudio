import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createApp, readConfig, validateAudioFile } from "../server.js";

const API_KEY = "test-key-never-return-this";
let server;
let origin;
let baseUrl;
let createStatus = 200;
let operationResult = { done: true, response: { assetId: "123456789" } };
const robloxRequests = [];

function makeWav(durationSeconds = 1) {
  const sampleRate = 8000;
  const sampleCount = Math.floor(sampleRate * durationSeconds);
  const dataLength = sampleCount * 2;
  const buffer = Buffer.alloc(44 + dataLength);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataLength, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataLength, 40);
  return buffer;
}

async function mockFetch(input, init = {}) {
  const url = String(input);
  if (url === "https://discord.com/api/v10/oauth2/token") {
    const code = new URLSearchParams(init.body).get("code");
    return Response.json({ access_token: `mock-discord-token-${code}` });
  }
  if (url === "https://discord.com/api/v10/users/@me") {
    const userId = init.headers.Authorization.slice("Bearer mock-discord-token-".length);
    return Response.json({ id: userId, username: "test-user", global_name: "Test User" });
  }
  if (url === "https://apis.roblox.com/assets/v1/assets") {
    robloxRequests.push({ headers: init.headers, body: init.body });
    if (createStatus !== 200) {
      return new Response(`upstream diagnostic includes ${API_KEY}`, { status: createStatus });
    }
    return Response.json({ path: "operations/test-operation" });
  }
  if (url === "https://apis.roblox.com/assets/v1/operations/test-operation") {
    robloxRequests.push({ headers: init.headers, operation: true });
    return Response.json(operationResult);
  }
  throw new Error(`Unexpected mock request: ${url}`);
}

async function authenticate(userId = "123456789012345678") {
  const start = await fetch(`${baseUrl}/auth/discord`, { redirect: "manual" });
  const state = new URL(start.headers.get("location")).searchParams.get("state");
  assert.ok(state);
  const callback = await fetch(`${baseUrl}/auth/callback?code=${encodeURIComponent(userId)}&state=${encodeURIComponent(state)}`, {
    redirect: "manual",
  });
  assert.equal(callback.status, 302);
  return callback.headers.get("set-cookie").split(";")[0];
}

before(async () => {
  const config = readConfig({
    NODE_ENV: "test",
    DISCORD_CLIENT_ID: "discord-client",
    DISCORD_CLIENT_SECRET: "discord-secret",
    DISCORD_REDIRECT_URI: "http://localhost/auth/callback",
    DISCORD_ALLOWED_USER_IDS: "123456789012345678",
    ROBLOX_OPEN_CLOUD_API_KEY: API_KEY,
    ROBLOX_CREATOR_TYPE: "user",
    ROBLOX_CREATOR_ID: "42",
  });
  const app = createApp({ config, fetchImpl: mockFetch });
  server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  origin = `http://127.0.0.1:${server.address().port}`;
  baseUrl = origin;
});

test("blocks a logged-in Discord account that is not on the server allowlist", async () => {
  const cookie = await authenticate("987654321098765432");
  const response = await fetch(`${baseUrl}/api/uploads`, {
    method: "POST",
    headers: { Cookie: cookie, Origin: origin },
  });
  assert.equal(response.status, 403);
  assert.match((await response.json()).error, /belum diizinkan/);
});

after(async () => {
  if (server) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

test("validates the Roblox creator settings without accepting arbitrary creator IDs", () => {
  const config = readConfig({
    ROBLOX_OPEN_CLOUD_API_KEY: API_KEY,
    ROBLOX_CREATOR_TYPE: "group",
    ROBLOX_CREATOR_ID: "123",
  });
  assert.equal(config.robloxConfigured, true);
  assert.equal(config.creatorLabel, "Group · 123");

  const invalid = readConfig({
    ROBLOX_OPEN_CLOUD_API_KEY: API_KEY,
    ROBLOX_CREATOR_TYPE: "group",
    ROBLOX_CREATOR_ID: "not-an-id",
  });
  assert.equal(invalid.robloxConfigured, false);
});

test("rejects mismatched, oversized, and over-duration audio", async () => {
  await assert.rejects(
    validateAudioFile({ originalname: "sound.mp3", buffer: makeWav() }),
    /does not match|tidak cocok/i,
  );
  await assert.rejects(
    validateAudioFile({ originalname: "sound.wav", buffer: Buffer.alloc(20 * 1024 * 1024 + 1) }),
    /20 MB/,
  );
  await assert.rejects(
    validateAudioFile({ originalname: "long.wav", buffer: makeWav(421) }),
    /7 menit/,
  );
});

test("requires an authenticated Discord session before accepting an upload", async () => {
  const response = await fetch(`${baseUrl}/api/uploads`, {
    method: "POST",
    headers: { Origin: origin },
  });
  assert.equal(response.status, 401);
  assert.match((await response.json()).error, /Discord/);
});

test("uploads through Open Cloud and reports success only after operation completion", async () => {
  createStatus = 200;
  operationResult = { done: true, response: { assetId: "123456789" } };
  robloxRequests.length = 0;
  const cookie = await authenticate();
  const form = new FormData();
  form.append("audio", new Blob([makeWav()], { type: "audio/wav" }), "ambient.wav");
  form.append("displayName", "Ambient");

  const uploadResponse = await fetch(`${baseUrl}/api/uploads`, {
    method: "POST",
    headers: { Cookie: cookie, Origin: origin },
    body: form,
  });
  assert.equal(uploadResponse.status, 202);
  assert.deepEqual(await uploadResponse.json(), { status: "processing", operationId: "test-operation" });
  assert.equal(robloxRequests[0].headers["x-api-key"], API_KEY);
  const payload = JSON.parse(robloxRequests[0].body.get("request"));
  assert.equal(payload.assetType, "Audio");
  assert.deepEqual(payload.creationContext.creator, { userId: 42 });

  const statusResponse = await fetch(`${baseUrl}/api/uploads/test-operation`, {
    headers: { Cookie: cookie },
  });
  assert.equal(statusResponse.status, 200);
  assert.deepEqual(await statusResponse.json(), { status: "completed", assetId: "123456789" });
});

test("keeps upstream API key diagnostics out of client-visible errors", async () => {
  createStatus = 403;
  const cookie = await authenticate();
  const form = new FormData();
  form.append("audio", new Blob([makeWav()], { type: "audio/wav" }), "ambient.wav");
  form.append("displayName", "Ambient");
  const response = await fetch(`${baseUrl}/api/uploads`, {
    method: "POST",
    headers: { Cookie: cookie, Origin: origin },
    body: form,
  });
  const result = await response.json();
  assert.equal(response.status, 502);
  assert.doesNotMatch(JSON.stringify(result), new RegExp(API_KEY));
  assert.match(result.error, /izin API key/);
  createStatus = 200;
});

test("rejects an oversized incoming multipart file", async () => {
  const cookie = await authenticate();
  const form = new FormData();
  form.append("audio", new Blob([Buffer.alloc(20 * 1024 * 1024 + 1)], { type: "audio/wav" }), "large.wav");
  form.append("displayName", "Large");
  const response = await fetch(`${baseUrl}/api/uploads`, {
    method: "POST",
    headers: { Cookie: cookie, Origin: origin },
    body: form,
  });
  assert.equal(response.status, 413);
  assert.match((await response.json()).error, /20 MB/);
});
