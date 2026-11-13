import test from "node:test";
import assert from "node:assert/strict";
import { AudioValidationError, validateRobloxAsset } from "../supabase/functions/_shared/asset-validation.js";

function png(width, height) {
  const bytes = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes);
  bytes.writeUInt32BE(13, 8);
  Buffer.from("IHDR").copy(bytes, 12);
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return new Uint8Array(bytes);
}

function tga(width, height) {
  const bytes = Buffer.alloc(18 + width * height * 3);
  bytes[2] = 2;
  bytes.writeUInt16LE(width, 12);
  bytes.writeUInt16LE(height, 14);
  bytes[16] = 24;
  return new Uint8Array(bytes);
}

test("valid Roblox Studio binary model files are accepted", async () => {
  const bytes = new TextEncoder().encode("<roblox!\0\0\0");
  const result = await validateRobloxAsset("Model", "house.rbxm", bytes);

  assert.equal(result.mime, "model/x-rbxm");
  assert.equal(result.assetType, "Model");
});

test("model filenames cannot disguise unrelated content", async () => {
  await assert.rejects(
    validateRobloxAsset("Model", "house.rbxm", new TextEncoder().encode("not a model")),
    (error) => error instanceof AudioValidationError && error.status === 415,
  );
});

test("decal uploads require a matching image signature and valid dimensions", async () => {
  const result = await validateRobloxAsset("Decal", "logo.png", png(512, 512));
  assert.equal(result.mime, "image/png");

  await assert.rejects(
    validateRobloxAsset("Decal", "logo.png", new TextEncoder().encode("not a png")),
    (error) => error instanceof AudioValidationError && error.status === 415,
  );
});

test("valid uncompressed TGA decals are accepted with their Roblox MIME type", async () => {
  const result = await validateRobloxAsset("Decal", "logo.tga", tga(2, 2));
  assert.equal(result.mime, "image/tga");
});

test("TGA decals reject malformed headers and oversized dimensions", async () => {
  await assert.rejects(
    validateRobloxAsset("Decal", "broken.tga", new Uint8Array(18)),
    (error) => error instanceof AudioValidationError && error.status === 415,
  );
  await assert.rejects(
    validateRobloxAsset("Decal", "large.tga", tga(8000, 1)),
    (error) => error instanceof AudioValidationError && error.status === 422,
  );
});

test("decal image dimensions must be below Roblox's 8000-pixel ceiling", async () => {
  await assert.rejects(
    validateRobloxAsset("Decal", "large.png", png(8000, 100)),
    (error) => error instanceof AudioValidationError && error.status === 422,
  );
});

test("decal uploads reject oversized files before content inspection", async () => {
  await assert.rejects(
    validateRobloxAsset("Decal", "large.png", new Uint8Array(20 * 1024 * 1024 + 1)),
    (error) => error instanceof AudioValidationError && error.status === 413,
  );
});

test("asset type must be supported by Roblox upload flow", async () => {
  await assert.rejects(
    validateRobloxAsset("Mesh", "asset.mesh", new Uint8Array([1])),
    (error) => error instanceof AudioValidationError && error.status === 400,
  );
});
