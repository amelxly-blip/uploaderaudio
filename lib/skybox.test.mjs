import test from "node:test";
import assert from "node:assert/strict";
import {
  buildSkyboxAtlasPrompt,
  buildSkyboxPrompt,
  buildSkyboxRbxmx,
  getSkyboxAtlasCells,
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

test("maps an exact 3-by-2 atlas to square Sky faces in documented order", () => {
  const cells = getSkyboxAtlasCells(3072, 2048);

  assert.deepEqual(cells.map(({ key, x, y, width, height }) => ({ key, x, y, width, height })), [
    { key: "Ft", x: 0, y: 0, width: 1024, height: 1024 },
    { key: "Bk", x: 1024, y: 0, width: 1024, height: 1024 },
    { key: "Lf", x: 2048, y: 0, width: 1024, height: 1024 },
    { key: "Rt", x: 0, y: 1024, width: 1024, height: 1024 },
    { key: "Up", x: 1024, y: 1024, width: 1024, height: 1024 },
    { key: "Dn", x: 2048, y: 1024, width: 1024, height: 1024 },
  ]);
});

test("rejects atlas images that cannot be split into six square faces", () => {
  assert.throws(() => getSkyboxAtlasCells(1024, 1024), /grid 3 kolom/);
  assert.throws(() => getSkyboxAtlasCells(1536, 1023), /grid 3 kolom/);
  assert.throws(() => getSkyboxAtlasCells(24000, 16000), /lebih kecil dari 8000/);
  assert.throws(() => getSkyboxAtlasCells(9000, 6000), /32 megapiksel/);
});

test("builds one prompt that specifies the exact atlas panel order and theme", () => {
  const prompt = buildSkyboxAtlasPrompt("heaven");

  assert.match(prompt, /grid rapat 3 kolom × 2 baris/);
  assert.match(prompt, /3072 × 2048/);
  assert.match(prompt, /Depan \(Ft\), Belakang \(Bk\), Kiri \(Lf\)/);
  assert.match(prompt, /Kanan \(Rt\), Atas \(Up\), Bawah \(Dn\)/);
  assert.match(prompt, /lautan awan putih/);
  assert.throws(() => buildSkyboxAtlasPrompt("missing"), /tidak dikenal/);
});
