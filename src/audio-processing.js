import { Mp3Encoder } from "@breezystack/lamejs";

export function getCompensationSpeed(playbackSpeed) {
  const speed = Number(playbackSpeed);
  if (!Number.isFinite(speed) || speed < 0.25 || speed > 1) {
    throw new RangeError("PlaybackSpeed harus antara 0.25 dan 1.");
  }
  return 1 / speed;
}

function toPcm16(samples) {
  const pcm = new Int16Array(samples.length);
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index]));
    pcm[index] = sample < 0 ? sample * 32768 : sample * 32767;
  }
  return pcm;
}

export async function processAudioForPlaybackSpeed(file, playbackSpeed) {
  const compensationSpeed = getCompensationSpeed(playbackSpeed);
  if (Math.abs(compensationSpeed - 1) < 0.0001) return file;

  const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
  const OfflineAudioContextConstructor = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!AudioContextConstructor || !OfflineAudioContextConstructor) {
    throw new Error("Browser ini belum mendukung pemrosesan audio. Coba Chrome, Edge, atau Firefox terbaru.");
  }

  const context = new AudioContextConstructor();
  try {
    const decoded = await context.decodeAudioData(await file.arrayBuffer());
    const sampleRate = 44100;
    const outputLength = Math.ceil(decoded.duration * playbackSpeed * sampleRate);
    const channels = decoded.numberOfChannels === 1 ? 1 : 2;
    const offline = new OfflineAudioContextConstructor(channels, outputLength, sampleRate);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.playbackRate.value = compensationSpeed;
    source.connect(offline.destination);
    source.start();
    const rendered = await offline.startRendering();

    const encoder = new Mp3Encoder(channels, sampleRate, 192);
    const leftSamples = rendered.getChannelData(0);
    const rightSamples = channels === 2 ? rendered.getChannelData(1) : null;
    const chunkSize = 1152;
    const encodedChunks = [];

    for (let offset = 0; offset < rendered.length; offset += chunkSize) {
      const end = Math.min(offset + chunkSize, rendered.length);
      const left = toPcm16(leftSamples.subarray(offset, end));
      const right = rightSamples ? toPcm16(rightSamples.subarray(offset, end)) : undefined;
      const encoded = encoder.encodeBuffer(left, right);
      if (encoded.length) encodedChunks.push(encoded);
    }

    const remainder = encoder.flush();
    if (remainder.length) encodedChunks.push(remainder);
    const processed = new File(
      encodedChunks,
      file.name.replace(/\.[^.]+$/, "") + ".mp3",
      { type: "audio/mpeg" },
    );
    if (!processed.size) throw new Error("Audio hasil pemrosesan kosong. Coba file lain.");
    if (processed.size > 20 * 1024 * 1024) {
      throw new Error("Ukuran audio hasil pemrosesan lebih dari 20 MB. Pilih PlaybackSpeed yang lebih dekat ke 1 atau file yang lebih pendek.");
    }
    return processed;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Ukuran audio hasil")) throw error;
    throw new Error("Audio gagal diproses. Pastikan file bisa diputar di browser lalu coba lagi.");
  } finally {
    await context.close();
  }
}
