import { fileTypeFromBuffer } from "file-type";
import { parseBuffer } from "music-metadata";

export const MAX_AUDIO_SIZE = 20 * 1024 * 1024;
export const MAX_AUDIO_DURATION_SECONDS = 7 * 60;

const AUDIO_TYPES = new Map([
  [".mp3", new Set(["audio/mpeg"])],
  [".ogg", new Set(["audio/ogg"])],
  [".wav", new Set(["audio/wav", "audio/vnd.wave"])],
  [".flac", new Set(["audio/flac", "audio/x-flac"])],
]);

export class AudioValidationError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export async function validateAudioFile(fileName, bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length === 0) {
    throw new AudioValidationError(400, "Pilih file audio sebelum upload.");
  }
  if (bytes.length > MAX_AUDIO_SIZE) {
    throw new AudioValidationError(413, "Ukuran file maksimal 20 MB.");
  }

  const safeName = String(fileName || "").split(/[\\/]/).pop() || "";
  const dot = safeName.lastIndexOf(".");
  const extension = dot >= 0 ? safeName.slice(dot).toLowerCase() : "";
  const allowedMimes = AUDIO_TYPES.get(extension);
  if (!allowedMimes) {
    throw new AudioValidationError(415, "Format audio yang didukung: MP3, OGG, WAV, dan FLAC.");
  }

  const detected = await fileTypeFromBuffer(bytes);
  if (!detected || !allowedMimes.has(detected.mime)) {
    throw new AudioValidationError(415, "Isi file tidak cocok dengan format audio yang dipilih.");
  }

  let metadata;
  try {
    metadata = await parseBuffer(bytes, { mimeType: detected.mime }, { duration: true });
  } catch {
    throw new AudioValidationError(422, "File audio tidak bisa dibaca. Ekspor ulang sebagai MP3, OGG, WAV, atau FLAC.");
  }
  const duration = metadata.format.duration;
  if (!Number.isFinite(duration)) {
    throw new AudioValidationError(422, "Durasi audio tidak bisa diverifikasi. Coba ekspor ulang file.");
  }
  if (duration > MAX_AUDIO_DURATION_SECONDS) {
    throw new AudioValidationError(422, "Durasi audio maksimal 7 menit.");
  }

  return { mime: detected.mime, duration, extension };
}
