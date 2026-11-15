import test from "node:test";
import assert from "node:assert/strict";
import {
  buildSkyboxPrompt,
  buildSkyboxRbxmx,
  normalizeSkyAssetId,
  SKYBOX_FACES,
  SKYBOX_PROMPTS,
} from "../src/skybox.js";

test("normalizes Roblox image asset IDs from common copy formats", () => {
  assert.equal(normalizeSkyAssetId("12345"), "12345");
  assert.equal(normalizeSkyAssetId("rbxassetid://12345"), "12345");
  assert.equal(normalizeSkyAssetId("https://www.roblox.com/library/12345/My-image"), "12345");
  assert.equal(normalizeSkyAssetId("javascript:alert(1)"), null);
});

test("builds an RBXMX Sky instance with all six escaped image references", () => {
  const faceIds = Object.fromEntries(SKYBOX_FACES.map((face, index) => [face.key, String(index + 1)]));
  const xml = buildSkyboxRbxmx('Moon & "Clouds"', faceIds);

  assert.match(xml, /<Item class="Sky" referent="RBX0">/);
  assert.match(xml, /<string name="Name">Moon &amp; &quot;Clouds&quot;<\/string>/);
  for (const face of SKYBOX_FACES) {
    assert.ok(xml.includes(`<Content name="${face.property}"><url>rbxassetid://${faceIds[face.key]}</url></Content>`));
  }
});

test("rejects incomplete or invalid image IDs and names", () => {
  assert.throws(() => buildSkyboxRbxmx("Sky", { Ft: "1" }), /sisi Belakang/);
  const allFaces = Object.fromEntries(SKYBOX_FACES.map((face) => [face.key, "123"]));
  allFaces.Lf = "<img>";
  assert.throws(() => buildSkyboxRbxmx("Sky", allFaces), /sisi Kiri/);
  assert.throws(() => buildSkyboxRbxmx(" ", Object.fromEntries(SKYBOX_FACES.map((face) => [face.key, "123"]))), /Nama Sky/);
});

test("builds one-face prompts that preserve the selected theme and orientation", () => {
  const prompt = buildSkyboxPrompt("moonlit", "Ft");
  assert.match(prompt, /fokus utama tema/i);
  assert.match(prompt, /Depan \(Ft\)/);
  assert.match(prompt, /SATU gambar/);
  assert.ok(SKYBOX_PROMPTS.length >= 19);
  assert.ok(SKYBOX_PROMPTS.some(({ id }) => id === "heaven"));
  assert.ok(SKYBOX_PROMPTS.some(({ id }) => id === "anime-sunset"));
  assert.throws(() => buildSkyboxPrompt("missing", "Ft"), /tidak dikenal/);
});
