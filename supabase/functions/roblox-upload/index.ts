import {
  AudioValidationError,
  validateAudioFile,
  MAX_AUDIO_SIZE,
} from "../_shared/audio-validation.js";
import {
  adminClient,
  authenticate,
  checkOrigin,
  decodeHeader,
  errorResponse,
  getRobloxConfig,
  HttpResponseError,
  jsonResponse,
  preflightResponse,
  readBoundedBody,
  requireAuthorized,
  robloxError,
  safeMessage,
} from "../_shared/http.ts";

const HOURLY_UPLOAD_LIMIT = 10;

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return preflightResponse(request);
  if (request.method !== "POST") {
    return jsonResponse(request, { error: "Metode tidak didukung." }, 405);
  }
  const originError = checkOrigin(request);
  if (originError) return originError;

  let uploadId: string | null = null;
  try {
    const { user } = await authenticate(request);
    await requireAuthorized(user.id);
    const config = getRobloxConfig();
    const displayName = decodeHeader(request.headers.get("x-audio-name"), "Nama asset", 50);
    const fileName = decodeHeader(request.headers.get("x-audio-filename"), "Nama file", 255);
    const bytes = await readBoundedBody(request, MAX_AUDIO_SIZE);
    let audio: { mime: string; duration: number; extension: string };
    try {
      audio = await validateAudioFile(fileName, bytes);
    } catch (error) {
      if (error instanceof AudioValidationError) {
        throw new HttpResponseError(error.status, error.message);
      }
      throw error;
    }

    const { data: quotaAvailable, error: quotaError } = await adminClient
      .rpc("consume_audio_upload_quota", { p_user_id: user.id });
    if (quotaError) throw new Error("Could not enforce upload quota.");
    if (!quotaAvailable) {
      throw new HttpResponseError(429, `Batas aplikasi ${HOURLY_UPLOAD_LIMIT} upload per jam tercapai.`);
    }

    const { data: row, error: insertError } = await adminClient
      .from("audio_uploads")
      .insert({
        user_id: user.id,
        display_name: displayName,
        file_size: bytes.byteLength,
        status: "processing",
      })
      .select("id")
      .single();
    if (insertError || !row) throw new Error("Could not create upload history record.");
    uploadId = row.id;

    const requestBody = {
      assetType: "Audio",
      displayName,
      description: "Audio uploaded through Roblox Open Cloud.",
      creationContext: { creator: config.creator },
    };
    const form = new FormData();
    form.append("request", JSON.stringify(requestBody));
    form.append("fileContent", new Blob([bytes], { type: audio.mime }), fileName);

    let response: Response;
    try {
      response = await fetch("https://apis.roblox.com/assets/v1/assets", {
        method: "POST",
        headers: { "x-api-key": config.apiKey },
        body: form,
        signal: AbortSignal.timeout(30000),
      });
    } catch {
      throw new HttpResponseError(502, "Roblox tidak merespons. Coba lagi setelah koneksi pulih.");
    }
    if (!response.ok) throw robloxError(response.status);

    const result = await response.json().catch(() => null);
    const operationPath = result?.path;
    if (typeof operationPath !== "string" || !/^operations\/[A-Za-z0-9._-]+$/.test(operationPath)) {
      throw new HttpResponseError(502, "Roblox tidak mengembalikan status operasi yang valid.");
    }
    const { error: updateError } = await adminClient
      .from("audio_uploads")
      .update({ operation_path: operationPath })
      .eq("id", uploadId)
      .eq("user_id", user.id);
    if (updateError) throw new Error("Could not save Roblox operation status.");

    return jsonResponse(request, { status: "processing", uploadId }, 202);
  } catch (error) {
    if (uploadId) {
      const { error: updateError } = await adminClient
        .from("audio_uploads")
        .update({ status: "failed", error_message: safeMessage(error) })
        .eq("id", uploadId);
      if (updateError) return jsonResponse(request, { error: "Upload gagal dan statusnya tidak bisa disimpan. Cek riwayat nanti." }, 500);
    }
    return errorResponse(request, error);
  }
});
