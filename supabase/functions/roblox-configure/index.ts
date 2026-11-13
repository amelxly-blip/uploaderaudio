import {
  authenticate,
  checkOrigin,
  errorResponse,
  HttpResponseError,
  jsonResponse,
  preflightResponse,
  readBoundedBody,
} from "../_shared/http.ts";
import { saveUserRobloxConfig } from "../_shared/roblox-credentials.ts";

const MAX_CONFIG_BODY_BYTES = 20 * 1024;
const BODY_ERRORS = {
  tooLarge: "Konfigurasi terlalu besar.",
  empty: "Konfigurasi Roblox wajib dikirim.",
};

function logRequestFailure(stage: string, error: unknown): void {
  const candidate = error && typeof error === "object" && "code" in error
    ? error.code
    : undefined;
  const code = typeof candidate === "string" && /^[A-Z0-9_]+$/.test(candidate)
    ? candidate
    : "unknown";
  console.error("[roblox-configure] request failed", {
    stage,
    errorType: error instanceof Error ? error.name : "UnknownError",
    code,
  });
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return preflightResponse(request);
  if (request.method !== "POST") {
    return jsonResponse(request, { error: "Metode tidak didukung." }, 405);
  }
  const originError = checkOrigin(request);
  if (originError) return originError;

  let stage = "authenticate";
  try {
    const { user } = await authenticate(request);
    stage = "read-body";
    const bytes = await readBoundedBody(request, MAX_CONFIG_BODY_BYTES, BODY_ERRORS);
    stage = "parse-body";
    let body: unknown;
    try {
      body = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      throw new HttpResponseError(400, "Format konfigurasi Roblox tidak valid.");
    }

    stage = "save-credentials";
    const saved = await saveUserRobloxConfig(user.id, body);
    return jsonResponse(request, {
      robloxConfigured: true,
      apiKeyConfigured: true,
      ...saved,
    });
  } catch (error) {
    if (!(error instanceof HttpResponseError)) logRequestFailure(stage, error);
    return errorResponse(request, error);
  }
});
