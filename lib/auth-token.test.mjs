import test from "node:test";
import assert from "node:assert/strict";
import { signToken, verifyToken } from "../supabase/functions/_shared/auth-token.js";

const secret = "test-secret-with-at-least-32-bytes-long";

test("signed auth tokens verify and preserve their payload", async () => {
  const payload = { sub: "123456789012345678", exp: 2_000_000_000 };
  const token = await signToken(payload, secret);

  assert.deepEqual(await verifyToken(token, secret), payload);
});

test("auth tokens reject a changed payload or signing secret", async () => {
  const token = await signToken({ sub: "123456789012345678" }, secret);
  const [payload, signature] = token.split(".");
  const changedPayload = `${payload.slice(0, -1)}${payload.endsWith("a") ? "b" : "a"}`;

  assert.equal(await verifyToken(`${changedPayload}.${signature}`, secret), null);
  assert.equal(await verifyToken(token, `${secret}-wrong`), null);
});

test("auth tokens reject malformed input and weak signing secrets", async () => {
  assert.equal(await verifyToken("not-a-token", secret), null);
  await assert.rejects(signToken({ sub: "123456789012345678" }, "short"));
});
