const STAGE_LABELS = {
  "operation-response": "Membaca hasil operasi Roblox",
  "asset-delivery-request": "Meminta konten Decal ke Asset Delivery",
  "asset-delivery-location": "Memvalidasi lokasi konten Decal",
  "decal-content-fetch": "Mengunduh konten Decal",
  "decal-xml-validation": "Memvalidasi XML Decal",
  "image-id-extraction": "Mengambil Image ID dari Decal",
  "roblox-asset-create": "Mengirim Decal ke Roblox",
  "operation-path": "Membaca status operasi Roblox",
  "save-operation": "Menyimpan status upload",
  "batch-request": "Mengirim batch Skybox ke server",
  "batch-stream": "Membaca progress batch Skybox",
  "operation-poll": "Memeriksa status upload",
};

const SAFE_CODE = /^[a-z0-9][a-z0-9_-]{0,47}$/i;
const SAFE_ASSET_TYPE = /^[a-z0-9_ -]{1,40}$/i;
const SAFE_DIAGNOSTIC_ID = /^[a-f0-9-]{36}$/i;

export function formatSkyboxDiagnostic(message, diagnostic) {
  const parts = [typeof message === "string" && message.trim() ? message.trim() : "Skybox gagal diproses."];
  if (!diagnostic || typeof diagnostic !== "object") return parts[0];

  const stage = STAGE_LABELS[diagnostic.stage];
  if (stage) parts.push(`Tahap: ${stage}`);
  if (typeof diagnostic.code === "string" && SAFE_CODE.test(diagnostic.code)) {
    parts.push(`Kode: ${diagnostic.code}`);
  }
  if (Number.isInteger(diagnostic.httpStatus) && diagnostic.httpStatus >= 100 && diagnostic.httpStatus <= 599) {
    parts.push(`HTTP: ${diagnostic.httpStatus}`);
  }
  if (typeof diagnostic.assetType === "string" && SAFE_ASSET_TYPE.test(diagnostic.assetType)) {
    parts.push(`Tipe Roblox: ${diagnostic.assetType}`);
  }
  if (typeof diagnostic.assetIdPresent === "boolean") {
    parts.push(`Asset ID diterima: ${diagnostic.assetIdPresent ? "ya" : "tidak"}`);
  }
  if (Number.isInteger(diagnostic.candidateCount) && diagnostic.candidateCount >= 0 && diagnostic.candidateCount <= 10) {
    parts.push(`Kandidat Image ID: ${diagnostic.candidateCount}`);
  }
  if (typeof diagnostic.diagnosticId === "string" && SAFE_DIAGNOSTIC_ID.test(diagnostic.diagnosticId)) {
    parts.push(`Ref: ${diagnostic.diagnosticId}`);
  }

  return parts.join(" · ");
}
