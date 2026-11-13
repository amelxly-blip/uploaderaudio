import { fileTypeFromBuffer } from "file-type";
import {
  AudioValidationError,
  MAX_AUDIO_SIZE,
  validateAudioFile,
} from "./audio-validation.js";

export { AudioValidationError };
export const MAX_ASSET_SIZE = MAX_AUDIO_SIZE;

const IMAGE_TYPES = new Map([
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".bmp", "image/bmp"],
  [".tga", "image/tga"],
]);

const TGA_IMAGE_TYPES = new Set([1, 2, 3, 9, 10, 11]);

function safeExtension(fileName) {
  return String(fileName || "").split(/[\\/]/).pop()?.split(".").pop()?.toLowerCase() || "";
}

function imageDimensions(bytes, mime) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (mime === "image/tga" && bytes.length >= 18) {
    return {
      width: view.getUint16(12, true),
      height: view.getUint16(14, true),
    };
  }
  if (mime === "image/png" && bytes.length >= 24) {
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (mime === "image/bmp" && bytes.length >= 26) {
    return {
      width: Math.abs(view.getInt32(18, true)),
      height: Math.abs(view.getInt32(22, true)),
    };
  }
  if (mime !== "image/jpeg") return null;

  let offset = 2;
  while (offset + 4 < bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1];
    offset += 2;
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    const segmentLength = view.getUint16(offset);
    if (segmentLength < 2 || offset + segmentLength > bytes.length) return null;
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      if (segmentLength < 7) return null;
      return {
        height: view.getUint16(offset + 3),
        width: view.getUint16(offset + 5),
      };
    }
    offset += segmentLength;
  }
  return null;
}

function isTga(bytes) {
  if (bytes.length < 18) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const idLength = bytes[0];
  const colorMapType = bytes[1];
  const imageType = bytes[2];
  const colorMapLength = view.getUint16(5, true);
  const colorMapDepth = bytes[7];
  const width = view.getUint16(12, true);
  const height = view.getUint16(14, true);
  const pixelDepth = bytes[16];
  const colorMapped = imageType === 1 || imageType === 9;
  const grayscale = imageType === 3 || imageType === 11;
  const validPixelDepth = colorMapped || grayscale
    ? pixelDepth === 8 || pixelDepth === 16
    : [15, 16, 24, 32].includes(pixelDepth);

  if (
    !TGA_IMAGE_TYPES.has(imageType)
    || !width
    || !height
    || !validPixelDepth
    || colorMapType !== (colorMapped ? 1 : 0)
    || (colorMapped && (!colorMapLength || ![15, 16, 24, 32].includes(colorMapDepth)))
  ) {
    return false;
  }

  const paletteBytes = colorMapped ? colorMapLength * Math.ceil(colorMapDepth / 8) : 0;
  const minimumLength = 18 + idLength + paletteBytes;
  if (bytes.length < minimumLength) return false;
  if (imageType === 9 || imageType === 10 || imageType === 11) return true;

  const pixelBytes = width * height * Math.ceil(pixelDepth / 8);
  return bytes.length >= minimumLength + pixelBytes;
}

function isRbxm(bytes) {
  return bytes.length >= 8
    && new TextDecoder().decode(bytes.subarray(0, 8)) === "<roblox!";
}

function isRbxmx(bytes) {
  const prefix = new TextDecoder().decode(bytes.subarray(0, Math.min(bytes.length, 256))).trimStart();
  return prefix.startsWith("<?xml") || /^<roblox(?:\s|>)/.test(prefix);
}

export async function validateRobloxAsset(assetType, fileName, bytes) {
  if (assetType === "Audio") return { ...await validateAudioFile(fileName, bytes), assetType };
  if (!["Decal", "Model"].includes(assetType)) {
    throw new AudioValidationError(400, "Jenis asset tidak valid.");
  }
  if (!(bytes instanceof Uint8Array) || bytes.length === 0) {
    throw new AudioValidationError(400, "Pilih file sebelum upload.");
  }
  if (bytes.length > MAX_ASSET_SIZE) {
    throw new AudioValidationError(413, "Ukuran file maksimal 20 MB.");
  }

  const extension = safeExtension(fileName);
  if (assetType === "Decal") {
    const expectedMime = IMAGE_TYPES.get(`.${extension}`);
    if (!expectedMime) {
      throw new AudioValidationError(415, "Format decal yang didukung: PNG, JPG, JPEG, BMP, dan TGA.");
    }
    const detectedMime = expectedMime === "image/tga"
      ? isTga(bytes) ? "image/tga" : null
      : (await fileTypeFromBuffer(bytes))?.mime ?? null;
    if (detectedMime !== expectedMime) {
      throw new AudioValidationError(415, "Isi file tidak cocok dengan format gambar yang dipilih.");
    }
    const dimensions = imageDimensions(bytes, detectedMime);
    if (!dimensions || dimensions.width < 1 || dimensions.height < 1) {
      throw new AudioValidationError(422, "Dimensi gambar tidak bisa dibaca.");
    }
    if (dimensions.width >= 8000 || dimensions.height >= 8000) {
      throw new AudioValidationError(422, "Ukuran gambar harus lebih kecil dari 8000 × 8000 piksel.");
    }
    return { assetType, extension, mime: detectedMime };
  }

  if (extension !== "rbxm" && extension !== "rbxmx") {
    throw new AudioValidationError(415, "Pilih file model .rbxm atau .rbxmx.");
  }
  if (!(extension === "rbxm" ? isRbxm(bytes) : isRbxmx(bytes))) {
    throw new AudioValidationError(415, "Header file tidak cocok dengan format model Roblox.");
  }
  return { assetType, extension, mime: "model/x-rbxm" };
}
