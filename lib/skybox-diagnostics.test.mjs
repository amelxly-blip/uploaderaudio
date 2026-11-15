import test from "node:test";
import assert from "node:assert/strict";
import { formatSkyboxDiagnostic } from "../src/skybox-diagnostics.js";

test("formats a safe, actionable Skybox resolution diagnostic for the UI", () => {
  assert.equal(
    formatSkyboxDiagnostic("Image ID tidak ditemukan.", {
      stage: "operation-response",
      code: "unexpected_asset_type",
      httpStatus: 200,
      assetType: "Decal",
      assetIdPresent: true,
      diagnosticId: "123e4567-e89b-12d3-a456-426614174000",
    }),
    "Image ID tidak ditemukan. · Tahap: Membaca hasil operasi Roblox · Kode: unexpected_asset_type · HTTP: 200 · Tipe Roblox: Decal · Asset ID diterima: ya · Ref: 123e4567-e89b-12d3-a456-426614174000",
  );
});

test("omits unrecognized or unsafe diagnostic fields", () => {
  assert.equal(
    formatSkyboxDiagnostic("Gagal.", {
      stage: "unknown-secret-stage",
      code: "key=private-value",
      httpStatus: 2000,
      diagnosticId: "not-a-uuid",
      apiKey: "must-not-be-shown",
    }),
    "Gagal.",
  );
});
