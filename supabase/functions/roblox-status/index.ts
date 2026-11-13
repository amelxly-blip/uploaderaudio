import {
  authenticate,
  checkOrigin,
  errorResponse,
  jsonResponse,
  preflightResponse,
} from "../_shared/http.ts";
import {
  getRobloxCreatorProfile,
  getUserRobloxConfig,
} from "../_shared/roblox-credentials.ts";

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
    const profile = config
      ? await getRobloxCreatorProfile(config.creatorType, config.creatorId)
      : null;
    return jsonResponse(request, {
      robloxConfigured: Boolean(config),
      apiKeyConfigured: Boolean(config),
      creatorType: config?.creatorType ?? "user",
      creatorId: config?.creatorId ?? "",
      creatorLabel: config?.label ?? "",
      profile,
    });
  } catch (error) {
    return errorResponse(request, error);
  }
});
