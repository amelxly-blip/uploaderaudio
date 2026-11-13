import {
  adminClient,
  authenticate,
  checkOrigin,
  errorResponse,
  getRobloxConfig,
  HttpResponseError,
  jsonResponse,
  preflightResponse,
  requireAuthorized,
  robloxError,
  safeMessage,
} from "../_shared/http.ts";

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return preflightResponse(request);
  if (request.method !== "POST") {
    return jsonResponse(request, { error: "Metode tidak didukung." }, 405);
  }
  const originError = checkOrigin(request);
  if (originError) return originError;

  try {
    const { user } = await authenticate(request);
    await requireAuthorized(user.id);
    const body = await request.json().catch(() => null);
    const uploadId = body?.uploadId;
    if (typeof uploadId !== "string" || !/^[0-9a-f-]{36}$/i.test(uploadId)) {
      throw new HttpResponseError(400, "ID upload tidak valid.");
    }

    const { data: upload, error: lookupError } = await adminClient
      .from("audio_uploads")
      .select("id,status,operation_path,asset_id,error_message")
      .eq("id", uploadId)
      .eq("discord_user_id", user.id)
      .maybeSingle();
    if (lookupError) throw new Error("Could not retrieve upload operation.");
    if (!upload) throw new HttpResponseError(404, "Status upload tidak ditemukan.");
    if (upload.status === "completed") {
      return jsonResponse(request, { status: "completed", assetId: upload.asset_id });
    }
    if (upload.status === "failed") {
      return jsonResponse(request, { status: "failed", error: upload.error_message });
    }
    if (!upload.operation_path) return jsonResponse(request, { status: "processing" });
    if (!/^operations\/[A-Za-z0-9._-]+$/.test(upload.operation_path)) {
      throw new Error("Stored Roblox operation path is invalid.");
    }

    const { apiKey } = getRobloxConfig();
    let response: Response;
    try {
      response = await fetch(`https://apis.roblox.com/assets/v1/${upload.operation_path}`, {
        headers: { "x-api-key": apiKey },
        signal: AbortSignal.timeout(10000),
      });
    } catch {
      throw new HttpResponseError(502, "Roblox tidak merespons saat memeriksa upload.");
    }
    if (!response.ok) throw robloxError(response.status);
    const operation = await response.json().catch(() => null);
    if (!operation || operation.done !== true) return jsonResponse(request, { status: "processing" });

    const assetId = operation.response?.assetId;
    if (assetId && /^\d+$/.test(String(assetId))) {
      const { error: updateError } = await adminClient
        .from("audio_uploads")
        .update({ status: "completed", asset_id: String(assetId), error_message: null })
        .eq("id", upload.id)
        .eq("discord_user_id", user.id);
      if (updateError) throw new Error("Could not save completed asset status.");
      return jsonResponse(request, { status: "completed", assetId: String(assetId) });
    }

    const message = "Roblox menolak upload ini. Periksa izin API key, kuota, dan moderasi di Creator Dashboard.";
    const { error: updateError } = await adminClient
      .from("audio_uploads")
      .update({ status: "failed", error_message: message })
      .eq("id", upload.id)
      .eq("discord_user_id", user.id);
    if (updateError) throw new Error("Could not save rejected asset status.");
    return jsonResponse(request, { status: "failed", error: message });
  } catch (error) {
    return errorResponse(request, error);
  }
});
