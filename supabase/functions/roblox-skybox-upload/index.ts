import {
  AudioValidationError,
  validateRobloxAsset,
  MAX_ASSET_SIZE,
} from "../_shared/asset-validation.js";
import {
  adminClient,
  authenticate,
  checkOrigin,
  errorResponse,
  HttpResponseError,
  jsonResponse,
  preflightResponse,
  readBoundedBody,
  responseHeaders,
  robloxError,
  safeMessage,
} from "../_shared/http.ts";
import { getUserRobloxConfig } from "../_shared/roblox-credentials.ts";

const DAILY_UPLOAD_LIMIT = 5;
const MAX_BATCH_SIZE = 20 * 1024 * 1024;
const MAX_REQUEST_SIZE = 24 * 1024 * 1024;
const SKYBOX_FACE_KEYS = ["Ft", "Bk", "Lf", "Rt", "Up", "Dn"] as const;
type SkyboxFaceKey = typeof SKYBOX_FACE_KEYS[number];

interface SkyboxFaceUpload {
  key: SkyboxFaceKey;
  bytes: Uint8Array;
  fileName: string;
  mime: string;
  displayName: string;
  uploadId: string;
  creator: { userId: number } | { groupId: number };
}

function isFile(value: FormDataEntryValue | null): value is File {
  return value instanceof File;
}

function faceDisplayName(name: string, key: SkyboxFaceKey): string {
  const suffix = ` ${key}`;
  return `${name.slice(0, 50 - suffix.length).trimEnd()}${suffix}`;
}

async function updateUpload(
  uploadId: string,
  discordUserId: string,
  values: Record<string, unknown>,
): Promise<void> {
  const { error } = await adminClient
    .from("audio_uploads")
    .update(values)
    .eq("id", uploadId)
    .eq("discord_user_id", discordUserId);
  if (error) throw new Error("Could not update Skybox upload history.");
}

function eventStreamResponse(request: Request, faces: SkyboxFaceUpload[], discordUserId: string, apiKey: string): Response {
  const encoder = new TextEncoder();
  let streamOpen = true;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (payload: Record<string, unknown>) => {
        if (!streamOpen) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
        } catch {
          streamOpen = false;
        }
      };
      const heartbeat = setInterval(() => send({ type: "heartbeat" }), 15000);

      void (async () => {
        for (const face of faces) {
          const requestBody = {
            assetType: "Decal",
            displayName: face.displayName,
            description: "Skybox face uploaded through Roblox Open Cloud.",
            creationContext: {
              creator: face.creator,
            },
          };
          const form = new FormData();
          form.append("request", JSON.stringify(requestBody));
          form.append("fileContent", new Blob([face.bytes], { type: face.mime }), face.fileName);

          let operationPath = "";
          let acceptedByRoblox = false;
          try {
            const response = await fetch("https://apis.roblox.com/assets/v1/assets", {
              method: "POST",
              headers: { "x-api-key": apiKey },
              body: form,
              signal: AbortSignal.timeout(30000),
            });
            if (!response.ok) throw robloxError(response.status);
            acceptedByRoblox = true;
            const result = await response.json().catch(() => null);
            operationPath = result?.path;
            if (typeof operationPath !== "string" || !/^operations\/[A-Za-z0-9._-]+$/.test(operationPath)) {
              throw new HttpResponseError(502, "Roblox tidak mengembalikan status operasi yang valid.");
            }
            await updateUpload(face.uploadId, discordUserId, { operation_path: operationPath });
            send({ type: "face", faceKey: face.key, status: "processing", uploadId: face.uploadId });
          } catch (error) {
            const message = acceptedByRoblox
              ? "Roblox menerima gambar, tetapi statusnya gagal disimpan. Periksa Creator Dashboard sebelum mengulangi upload."
              : safeMessage(error);
            try {
              await updateUpload(face.uploadId, discordUserId, {
                status: "failed",
                error_message: message,
              });
            } catch (updateError) {
              console.error("Could not save failed Skybox upload status.", updateError);
            }
            send({ type: "face", faceKey: face.key, status: "failed", error: message });
          }
        }
        send({ type: "complete" });
      })().catch((error) => {
        console.error("Skybox batch processing failed.", error);
        send({ type: "fatal", error: "Batch upload berhenti sebelum semua sisi diproses." });
      }).finally(() => {
        clearInterval(heartbeat);
        if (streamOpen) {
          try {
            controller.close();
          } catch {
            streamOpen = false;
          }
        }
      });
    },
    cancel() {
      streamOpen = false;
    },
  });
  const headers = responseHeaders(request);
  headers.set("Content-Type", "text/event-stream; charset=utf-8");
  headers.set("Cache-Control", "no-cache, no-store");
  headers.set("X-Accel-Buffering", "no");
  return new Response(body, { status: 200, headers });
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return preflightResponse(request);
  if (request.method !== "POST") {
    return jsonResponse(request, { error: "Metode tidak didukung." }, 405);
  }
  const originError = checkOrigin(request);
  if (originError) return originError;

  try {
    const { user } = await authenticate(request);
    const config = await getUserRobloxConfig(user.id);
    if (!config) {
      throw new HttpResponseError(409, "Lengkapi Creator ID dan API key Roblox di halaman Setup sebelum upload.");
    }

    const bodyBytes = await readBoundedBody(request, MAX_REQUEST_SIZE, {
      tooLarge: "Total ukuran batch Skybox maksimal 20 MB.",
      empty: "Pilih atlas Skybox sebelum upload.",
    });
    let form: FormData;
    try {
      form = await new Request(request.url, {
        method: "POST",
        headers: request.headers,
        body: bodyBytes,
      }).formData();
    } catch {
      throw new HttpResponseError(400, "Data atlas Skybox tidak valid.");
    }

    const displayNameEntry = form.get("displayName");
    const displayName = typeof displayNameEntry === "string" ? displayNameEntry.trim() : "";
    if (!displayName || displayName.length > 50 || /[\u0000-\u001f\u007f]/.test(displayName)) {
      throw new HttpResponseError(400, "Nama Sky harus berisi 1 sampai 50 karakter.");
    }
    const expectedFields = new Set(["displayName", ...SKYBOX_FACE_KEYS.map((key) => `face_${key}`)]);
    if ([...form.keys()].some((key) => !expectedFields.has(key))) {
      throw new HttpResponseError(400, "Batch hanya boleh berisi enam gambar sisi Skybox.");
    }

    const faces: Omit<SkyboxFaceUpload, "uploadId" | "creator">[] = [];
    let totalSize = 0;
    for (const key of SKYBOX_FACE_KEYS) {
      const entries = form.getAll(`face_${key}`);
      if (entries.length !== 1 || !isFile(entries[0])) {
        throw new HttpResponseError(400, `Gambar sisi ${key} tidak ditemukan atau tidak valid.`);
      }
      const file = entries[0];
      if (file.size === 0 || file.size > MAX_ASSET_SIZE) {
        throw new HttpResponseError(413, `Ukuran gambar sisi ${key} harus lebih dari 0 dan maksimal 20 MB.`);
      }
      totalSize += file.size;
      if (totalSize > MAX_BATCH_SIZE) {
        throw new HttpResponseError(413, "Total ukuran enam gambar hasil potong maksimal 20 MB.");
      }
      const bytes = new Uint8Array(await file.arrayBuffer());
      let asset: { mime: string };
      try {
        asset = await validateRobloxAsset("Decal", file.name, bytes);
      } catch (error) {
        if (error instanceof AudioValidationError) {
          throw new HttpResponseError(error.status, `Sisi ${key}: ${error.message}`);
        }
        throw error;
      }
      faces.push({
        key,
        bytes,
        fileName: `${faceDisplayName(displayName, key)}.jpg`,
        mime: asset.mime,
        displayName: faceDisplayName(displayName, key),
      });
    }

    const { data: quotaAvailable, error: quotaError } = await adminClient
      .rpc("consume_discord_audio_upload_quota", { p_discord_user_id: user.id });
    if (quotaError) throw new Error("Could not enforce upload quota.");
    if (!quotaAvailable) {
      throw new HttpResponseError(429, `Batas aplikasi ${DAILY_UPLOAD_LIMIT} percobaan dalam 24 jam tercapai.`);
    }

    const { data: rows, error: insertError } = await adminClient
      .from("audio_uploads")
      .insert(faces.map((face) => ({
        discord_user_id: user.id,
        display_name: face.displayName,
        file_size: face.bytes.byteLength,
        asset_type: "Decal",
        status: "processing",
      })))
      .select("id,display_name");
    if (insertError || !rows || rows.length !== SKYBOX_FACE_KEYS.length) {
      throw new Error("Could not create Skybox upload history records.");
    }
    const uploadIds = new Map(rows.map((row) => [row.display_name, row.id]));
    const preparedFaces = faces.map((face) => {
      const uploadId = uploadIds.get(face.displayName);
      if (typeof uploadId !== "string") throw new Error("Skybox upload history ID is missing.");
      return { ...face, uploadId, creator: config.creator };
    });

    return eventStreamResponse(request, preparedFaces, user.id, config.apiKey);
  } catch (error) {
    return errorResponse(request, error);
  }
});
