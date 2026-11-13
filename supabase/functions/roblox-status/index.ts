import {
  authenticate,
  checkOrigin,
  errorResponse,
  getRobloxConfig,
  HttpResponseError,
  jsonResponse,
  preflightResponse,
} from "../_shared/http.ts";

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return preflightResponse(request);
  if (request.method !== "POST") {
    return jsonResponse(request, { error: "Metode tidak didukung." }, 405);
  }
  const originError = checkOrigin(request);
  if (originError) return originError;

  try {
    await authenticate(request);

    try {
      const config = getRobloxConfig();
      return jsonResponse(request, {
        robloxConfigured: true,
        apiKeyConfigured: true,
        creatorLabel: config.label,
      });
    } catch (error) {
      if (!(error instanceof HttpResponseError) || error.status !== 503) throw error;
      return jsonResponse(request, {
        robloxConfigured: false,
        apiKeyConfigured: Boolean(Deno.env.get("ROBLOX_OPEN_CLOUD_API_KEY")?.trim()),
        creatorLabel: "",
      });
    }
  } catch (error) {
    return errorResponse(request, error);
  }
});
