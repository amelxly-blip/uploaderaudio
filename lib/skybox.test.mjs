import test from "node:test";
import assert from "node:assert/strict";
import {
  buildSkyboxPanoramaPrompt,
  buildSkyboxPrompt,
  buildSkyboxRbxmx,
  getSkyboxAtlasCells,
  getSkyboxPanoramaFaceSize,
  getSkyboxPanoramaRegion,
  isSkyboxPanoramaImage,
  normalizeSkyAssetId,
  projectEquirectangularFace,
  SKYBOX_FACES,
  SKYBOX_PROMPTS,
} from "../src/skybox.js";

function createDirectionalPanorama(width, height) {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const latitude = (0.5 - (y + 0.5) / height) * Math.PI;
    for (let x = 0; x < width; x += 1) {
      const longitude = ((x + 0.5) / width - 0.5) * 2 * Math.PI;
      const horizontalScale = Math.cos(latitude);
      const direction = [
        Math.sin(longitude) * horizontalScale,
        Math.sin(latitude),
        -Math.cos(longitude) * horizontalScale,
      ];
      const offset = (y * width + x) * 4;
      pixels[offset] = Math.round((direction[0] + 1) * 127.5);
      pixels[offset + 1] = Math.round((direction[1] + 1) * 127.5);
      pixels[offset + 2] = Math.round((direction[2] + 1) * 127.5);
      pixels[offset + 3] = 255;
    }
  }
  return pixels;
}

function getPixel(pixels, size, x, y) {
  const offset = (y * size + x) * 4;
  return pixels.subarray(offset, offset + 3);
}

function assertEdgesClose(first, firstX, firstY, second, secondX, secondY, size) {
  let maxDifference = 0;
  for (let index = 1; index < size - 1; index += 1) {
    const a = getPixel(first, size, firstX(index), firstY(index));
    const b = getPixel(second, size, secondX(index), secondY(index));
    for (let channel = 0; channel < 3; channel += 1) {
      maxDifference = Math.max(maxDifference, Math.abs(a[channel] - b[channel]));
    }
  }
  assert.ok(maxDifference < 12, `Cubemap edge mismatch reached ${maxDifference} color levels.`);
}

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
  assert.match(prompt, /proyeksi cubemap 90 derajat/i);
  assert.match(prompt, /depan \(-Z\), kanan gambar ke \+X dan atas gambar ke \+Y/i);
  assert.match(prompt, /Depan \(Ft\)/);
  assert.match(prompt, /SATU tekstur/);
  assert.match(prompt, /bukan poster atau pemandangan terpisah/i);
  assert.match(prompt, /jangan tampilkan kubus, dinding, sudut ruangan/i);
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

test("prompts for one seamless 2:1 equirectangular sky panorama", () => {
  const prompt = buildSkyboxPanoramaPrompt("daylight");

  assert.match(prompt, /SATU gambar panorama langit 360 derajat/i);
  assert.match(prompt, /equirectangular/i);
  assert.match(prompt, /rasio tepat 2:1/i);
  assert.match(prompt, /bukan atlas 3×2/i);
  assert.match(prompt, /tepi kiri dan kanan harus menyambung/i);
  assert.match(prompt, /cakrawala.*tengah/i);
  assert.match(prompt, /awan cumulus besar/i);
  assert.throws(() => buildSkyboxPanoramaPrompt("missing"), /tidak dikenal/);
});

test("converts a single equirectangular panorama into six edge-aligned Sky faces", () => {
  const width = 512;
  const height = 256;
  const faceSize = getSkyboxPanoramaFaceSize(width, height);
  const panorama = createDirectionalPanorama(width, height);
  const faces = Object.fromEntries(SKYBOX_FACES.map(({ key }) => [
    key,
    projectEquirectangularFace(panorama, width, height, key, faceSize),
  ]));
  const center = Math.floor(faceSize / 2);

  assert.equal(faceSize, 128);
  assert.equal(faces.Ft.length, faceSize * faceSize * 4);
  assert.ok(getPixel(faces.Ft, faceSize, center, center)[2] < 12);
  assert.ok(getPixel(faces.Rt, faceSize, center, center)[0] > 243);
  assert.ok(getPixel(faces.Lf, faceSize, center, center)[0] < 12);
  assert.ok(getPixel(faces.Up, faceSize, center, center)[1] > 243);
  assert.ok(getPixel(faces.Dn, faceSize, center, center)[1] < 12);

  assertEdgesClose(faces.Ft, () => faceSize - 1, (index) => index, faces.Rt, () => 0, (index) => index, faceSize);
  assertEdgesClose(faces.Ft, () => 0, (index) => index, faces.Lf, () => faceSize - 1, (index) => index, faceSize);
  assertEdgesClose(faces.Ft, (index) => index, () => 0, faces.Up, (index) => index, () => 0, faceSize);
  assertEdgesClose(faces.Ft, (index) => index, () => faceSize - 1, faces.Dn, (index) => index, () => faceSize - 1, faceSize);
});

test("accepts rounded 2:1 panoramas and rejects invalid or undersized ones", () => {
  assert.equal(isSkyboxPanoramaImage(893, 502), true);
  assert.equal(isSkyboxPanoramaImage(1024, 1024), false);
  assert.deepEqual(getSkyboxPanoramaRegion(893, 502), {
    x: 0,
    y: 28,
    width: 893,
    height: 446,
  });
  assert.deepEqual(getSkyboxPanoramaRegion(2304, 1024), {
    x: 128,
    y: 0,
    width: 2048,
    height: 1024,
  });
  assert.equal(getSkyboxPanoramaFaceSize(893, 447), 223);
  assert.throws(() => getSkyboxPanoramaFaceSize(1024, 1024), /rasio 2:1/);
  assert.throws(() => getSkyboxPanoramaRegion(1024, 1024), /rasio sekitar 2:1/);
  assert.throws(() => getSkyboxPanoramaFaceSize(511, 256), /minimal 512 × 256/);
});
