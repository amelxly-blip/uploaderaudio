import {
  authenticate,
  checkOrigin,
  errorResponse,
  getRobloxConfig,
  HttpResponseError,
  isAuthorized,
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
    const { user } = await authenticate(request);
    const authorized = await isAuthorized(user.id);

    try {
      const config = getRobloxConfig();
      return jsonResponse(request, {
        authorized,
        robloxConfigured: authorized,
        apiKeyConfigured: authorized,
        creatorLabel: authorized ? config.label : "",
      });
    } catch (error) {
      if (!(error instanceof HttpResponseError) || error.status !== 503) throw error;
      return jsonResponse(request, {
        authorized,
        robloxConfigured: false,
        apiKeyConfigured: Boolean(authorized && Deno.env.get("ROBLOX_OPEN_CLOUD_API_KEY")),
        creatorLabel: "",
      });
    }
  } catch (error) {
    return errorResponse(request, error);
  }
});
