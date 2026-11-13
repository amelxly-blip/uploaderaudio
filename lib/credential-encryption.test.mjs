import test from "node:test";
import assert from "node:assert/strict";
import { decryptApiKey, encryptApiKey } from "../supabase/functions/_shared/credential-encryption.js";

const secret = "test-bridge-secret-with-at-least-32-bytes";
const firstUser = "123456789012345678";
const secondUser = "123456789012345679";

test("Roblox API keys encrypt and decrypt only for the matching Discord user", async () => {
  const encrypted = await encryptApiKey("test-roblox-api-key", secret, firstUser);

  assert.equal(await decryptApiKey(encrypted.ciphertext, encrypted.nonce, secret, firstUser), "test-roblox-api-key");
  await assert.rejects(decryptApiKey(encrypted.ciphertext, encrypted.nonce, secret, secondUser));
});

test("encrypted Roblox API keys reject tampering and a different secret", async () => {
  const encrypted = await encryptApiKey("test-roblox-api-key", secret, firstUser);
  const changedCiphertext = `${encrypted.ciphertext.slice(0, -1)}${encrypted.ciphertext.endsWith("a") ? "b" : "a"}`;

  await assert.rejects(decryptApiKey(changedCiphertext, encrypted.nonce, secret, firstUser));
  await assert.rejects(decryptApiKey(encrypted.ciphertext, encrypted.nonce, `${secret}-wrong`, firstUser));
});

test("credential encryption rejects weak secrets and malformed user IDs", async () => {
  await assert.rejects(encryptApiKey("test-roblox-api-key", "short", firstUser));
  await assert.rejects(encryptApiKey("test-roblox-api-key", secret, "not-a-discord-id"));
});
