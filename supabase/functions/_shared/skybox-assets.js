export const SKYBOX_ASSET_TYPE = "Image";
export const SKYBOX_UPLOAD_ASSET_TYPE = "Decal";

const ASSET_DELIVERY_URL = "https://apis.roblox.com/asset-delivery-api/v1/assetId/";
const MAX_DECAL_METADATA_BYTES = 1024 * 1024;
const IMAGE_CONTENT_PROPERTIES = new Set(["texture", "texturecontent", "colormap", "colormapcontent"]);
const ROBLOX_DOMAINS = ["roblox.com", "rbxcdn.com"];

export class RobloxImageIdResolutionError extends Error {
  constructor(message) {
    super(message);
    this.name = "RobloxImageIdResolutionError";
  }
}

function isRobloxAssetUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  const isRobloxHost = ROBLOX_DOMAINS.some((domain) =>
    url.hostname === domain || url.hostname.endsWith(`.${domain}`)
  );
  return url.protocol === "https:"
    && !url.username
    && !url.password
    && (!url.port || url.port === "443")
    && isRobloxHost;
}

function decodeXmlText(value) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function imageIdFromContentUri(value) {
  const uri = decodeXmlText(value.trim());
  const assetUriMatch = uri.match(/^rbxassetid:\/\/(\d+)$/i);
  if (assetUriMatch) return assetUriMatch[1];

  let url;
  try {
    url = new URL(uri);
  } catch {
    return null;
  }
  const isRobloxHost = ROBLOX_DOMAINS.some((domain) =>
    url.hostname === domain || url.hostname.endsWith(`.${domain}`)
  );
  if (!isRobloxHost || !["http:", "https:"].includes(url.protocol)) return null;

  const queryId = url.searchParams.get("id");
  if (queryId && /^\d+$/.test(queryId)) return queryId;

  const pathId = url.pathname.match(/\/(?:assetId|assets)\/(\d+)(?:\/|$)/i);
  return pathId?.[1] ?? null;
}

export function getRobloxAssetId(response, expectedAssetType = null) {
  if (!response || typeof response !== "object") return null;
  if (expectedAssetType && response.assetType !== expectedAssetType) return null;

  const assetId = response.assetId;
  if ((typeof assetId !== "number" && typeof assetId !== "string") || !/^\d+$/.test(String(assetId))) {
    return null;
  }
  return String(assetId);
}

export function extractDecalImageAssetId(xml) {
  if (typeof xml !== "string" || !/<roblox(?:\s|>)/i.test(xml)) {
    throw new RobloxImageIdResolutionError("Roblox tidak mengembalikan konten Decal XML yang valid.");
  }
  if (new TextEncoder().encode(xml).byteLength > MAX_DECAL_METADATA_BYTES) {
    throw new RobloxImageIdResolutionError("Konten Decal Roblox terlalu besar untuk dibaca.");
  }

  const imageIds = new Set();
  for (const [, attributes, content] of xml.matchAll(/<Content\b([^>]*)>([\s\S]*?)<\/Content>/gi)) {
    const propertyName = attributes.match(/\bname\s*=\s*["']([^"']+)["']/i)?.[1]?.toLowerCase();
    if (!IMAGE_CONTENT_PROPERTIES.has(propertyName)) continue;

    const url = content.match(/<url(?:\s[^>]*)?>([\s\S]*?)<\/url>/i)?.[1];
    if (!url) continue;

    const imageId = imageIdFromContentUri(url);
    if (imageId) imageIds.add(imageId);
  }

  if (imageIds.size !== 1) {
    throw new RobloxImageIdResolutionError(
      "ID Image tidak ditemukan secara unik di konten Decal Roblox; ID Decal tidak digunakan.",
    );
  }
  return imageIds.values().next().value;
}

async function readDecalXml(response) {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_DECAL_METADATA_BYTES) {
    throw new RobloxImageIdResolutionError("Konten Decal Roblox terlalu besar untuk dibaca.");
  }
  const xml = await response.text();
  if (new TextEncoder().encode(xml).byteLength > MAX_DECAL_METADATA_BYTES) {
    throw new RobloxImageIdResolutionError("Konten Decal Roblox terlalu besar untuk dibaca.");
  }
  return xml;
}

export async function resolveDecalImageAssetId(decalAssetId, apiKey, fetchImpl = fetch) {
  if (!/^\d+$/.test(String(decalAssetId))) {
    throw new RobloxImageIdResolutionError("ID Decal Roblox tidak valid.");
  }

  let assetResponse;
  try {
    assetResponse = await fetchImpl(`${ASSET_DELIVERY_URL}${decalAssetId}`, {
      headers: {
        "x-api-key": apiKey,
        AssetType: SKYBOX_UPLOAD_ASSET_TYPE,
        AssetFormat: "xml",
      },
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    throw new RobloxImageIdResolutionError("Roblox tidak merespons saat membaca Image ID dari Decal.");
  }

  if (assetResponse.status === 401 || assetResponse.status === 403) {
    throw new RobloxImageIdResolutionError(
      "Roblox menolak membaca konten Decal. API key perlu izin Assets: Read selain Write.",
    );
  }
  if (assetResponse.status === 429) {
    throw new RobloxImageIdResolutionError("Batas permintaan Roblox tercapai saat membaca Image ID. Coba lagi nanti.");
  }
  if (!assetResponse.ok) {
    throw new RobloxImageIdResolutionError("Roblox gagal menyediakan konten Decal untuk mengambil Image ID.");
  }

  let assetLocation;
  try {
    assetLocation = (await assetResponse.json())?.location;
  } catch {
    throw new RobloxImageIdResolutionError("Roblox tidak mengembalikan lokasi konten Decal yang valid.");
  }
  if (typeof assetLocation !== "string" || !isRobloxAssetUrl(assetLocation)) {
    throw new RobloxImageIdResolutionError("Roblox tidak mengembalikan lokasi konten Decal yang valid.");
  }

  let contentResponse;
  try {
    contentResponse = await fetchImpl(assetLocation, {
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    throw new RobloxImageIdResolutionError("Konten Decal Roblox tidak dapat diunduh untuk mengambil Image ID.");
  }
  if (!contentResponse.ok || contentResponse.url && !isRobloxAssetUrl(contentResponse.url)) {
    throw new RobloxImageIdResolutionError("Konten Decal Roblox gagal dibaca untuk mengambil Image ID.");
  }

  return extractDecalImageAssetId(await readDecalXml(contentResponse));
}

export async function getSkyboxImageAssetId(operationResponse, apiKey, fetchImpl = fetch) {
  if (operationResponse?.assetType === "ASSET_TYPE_IMAGE") {
    const imageId = getRobloxAssetId(operationResponse, "ASSET_TYPE_IMAGE");
    if (imageId) return imageId;
  } else if (operationResponse?.assetType === "ASSET_TYPE_DECAL") {
    const decalId = getRobloxAssetId(operationResponse, "ASSET_TYPE_DECAL");
    if (decalId) return resolveDecalImageAssetId(decalId, apiKey, fetchImpl);
  }

  throw new RobloxImageIdResolutionError(
    "Roblox tidak mengembalikan ID Decal atau Image yang valid untuk sisi Skybox.",
  );
}
