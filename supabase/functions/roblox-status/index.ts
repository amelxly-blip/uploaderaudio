import {
  adminClient,
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
    const { user } = await authenticate(request);
    const { data, error } = await adminClient
      .from("authorized_uploaders")
      .select("user_id")
      .eq("user_id", user.id)
      .maybeSingle();
    if (error) throw new Error("Could not verify uploader access.");

    try {
      const config = getRobloxConfig();
      return jsonResponse(request, {
        authorized: Boolean(data),
        robloxConfigured: Boolean(data),
        apiKeyConfigured: Boolean(data),
        creatorLabel: data ? config.label : "",
      });
    } catch (error) {
      if (!(error instanceof HttpResponseError) || error.status !== 503) throw error;
      return jsonResponse(request, {
        authorized: Boolean(data),
        robloxConfigured: false,
        apiKeyConfigured: Boolean(data && Deno.env.get("ROBLOX_OPEN_CLOUD_API_KEY")),
        creatorLabel: "",
      });
    }
  } catch (error) {
    return errorResponse(request, error);
  }
});
