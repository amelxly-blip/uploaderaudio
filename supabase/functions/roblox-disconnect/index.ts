import {
  authenticate,
  checkOrigin,
  errorResponse,
  jsonResponse,
  preflightResponse,
} from "../_shared/http.ts";
import { deleteUserRobloxConfig } from "../_shared/roblox-credentials.ts";

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return preflightResponse(request);
  if (request.method !== "POST") {
    return jsonResponse(request, { error: "Metode tidak didukung." }, 405);
  }
  const originError = checkOrigin(request);
  if (originError) return originError;

  try {
    const { user } = await authenticate(request);
    await deleteUserRobloxConfig(user.id);
    return jsonResponse(request, { robloxConfigured: false });
  } catch (error) {
    return errorResponse(request, error);
  }
});
