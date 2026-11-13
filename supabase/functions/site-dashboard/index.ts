import {
  adminClient,
  authenticate,
  checkOrigin,
  errorResponse,
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
    if (!user.username || !user.displayName || !user.avatarUrl) {
      return jsonResponse(request, {
        error: "Sesi Discord perlu diperbarui. Masuk lagi.",
      }, 401);
    }

    const { data, error } = await adminClient.rpc("get_site_dashboard", {
      p_discord_user_id: user.id,
      p_username: user.username,
      p_display_name: user.displayName,
      p_avatar_url: user.avatarUrl,
    });
    if (error) {
      console.error("Site dashboard query failed.", error.code);
      throw new Error("Site dashboard query failed.");
    }
    return jsonResponse(request, data as Record<string, unknown>);
  } catch (error) {
    return errorResponse(request, error);
  }
});
