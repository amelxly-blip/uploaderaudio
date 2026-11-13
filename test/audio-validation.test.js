import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AudioValidationError,
  MAX_AUDIO_DURATION_SECONDS,
  MAX_AUDIO_SIZE,
  validateAudioFile,
} from "../supabase/functions/_shared/audio-validation.js";

function makeWav(durationSeconds = 1) {
  const sampleRate = 8000;
  const sampleCount = Math.floor(sampleRate * durationSeconds);
  const dataLength = sampleCount * 2;
  const buffer = Buffer.alloc(44 + dataLength);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataLength, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataLength, 40);
  return buffer;
}

test("accepts a valid WAV and reads its duration and actual MIME type", async () => {
  const result = await validateAudioFile("ambient.wav", makeWav(2));
  assert.equal(result.mime, "audio/wav");
  assert.equal(result.duration, 2);
  assert.equal(result.extension, ".wav");
});

test("rejects a file signature that does not match the filename", async () => {
  await assert.rejects(
    validateAudioFile("ambient.mp3", makeWav()),
    (error) => error instanceof AudioValidationError && error.status === 415,
  );
});

test("rejects files over the Roblox size ceiling", async () => {
  await assert.rejects(
    validateAudioFile("ambient.wav", Buffer.alloc(MAX_AUDIO_SIZE + 1)),
    (error) => error instanceof AudioValidationError && error.status === 413,
  );
});

test("rejects audio longer than seven minutes", async () => {
  await assert.rejects(
    validateAudioFile("long.wav", makeWav(MAX_AUDIO_DURATION_SECONDS + 1)),
    (error) => error instanceof AudioValidationError && error.status === 422,
  );
});

test("rejects empty or unsupported files explicitly", async () => {
  await assert.rejects(
    validateAudioFile("empty.wav", new Uint8Array()),
    (error) => error instanceof AudioValidationError && error.status === 400,
  );
  await assert.rejects(
    validateAudioFile("archive.zip", makeWav()),
    (error) => error instanceof AudioValidationError && error.status === 415,
  );
});
