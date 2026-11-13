const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const salt = encoder.encode("mchlern-audio-user-credentials-v1");
const info = encoder.encode("roblox-open-cloud-api-key-aes-gcm-v1");

function encodeBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeBase64Url(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error("Invalid encrypted credential encoding.");
  }
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  let binary;
  try {
    binary = atob(base64 + "=".repeat((4 - base64.length % 4) % 4));
  } catch {
    throw new Error("Invalid encrypted credential encoding.");
  }
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (encodeBase64Url(bytes) !== value) throw new Error("Invalid encrypted credential encoding.");
  return bytes;
}

function additionalData(discordUserId) {
  if (typeof discordUserId !== "string" || !/^[0-9]{17,20}$/.test(discordUserId)) {
    throw new Error("Invalid Discord user ID.");
  }
  return encoder.encode(`discord-user:${discordUserId}:roblox-api-key:v1`);
}

async function deriveKey(secret, usages) {
  if (typeof secret !== "string" || encoder.encode(secret).byteLength < 32) {
    throw new Error("Credential encryption secret must be at least 32 bytes.");
  }
  const inputKey = await crypto.subtle.importKey("raw", encoder.encode(secret), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt, info },
    inputKey,
    { name: "AES-GCM", length: 256 },
    false,
    usages,
  );
}

export async function encryptApiKey(apiKey, secret, discordUserId) {
  if (typeof apiKey !== "string" || !apiKey) throw new Error("API key must not be empty.");
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(secret, ["encrypt"]);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce, additionalData: additionalData(discordUserId) },
    key,
    encoder.encode(apiKey),
  );
  return {
    ciphertext: encodeBase64Url(new Uint8Array(ciphertext)),
    nonce: encodeBase64Url(nonce),
  };
}

export async function decryptApiKey(ciphertext, nonce, secret, discordUserId) {
  const encryptedBytes = decodeBase64Url(ciphertext);
  const nonceBytes = decodeBase64Url(nonce);
  if (nonceBytes.byteLength !== 12) throw new Error("Invalid encrypted credential nonce.");
  const key = await deriveKey(secret, ["decrypt"]);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: nonceBytes, additionalData: additionalData(discordUserId) },
    key,
    encryptedBytes,
  );
  return decoder.decode(plaintext);
}
