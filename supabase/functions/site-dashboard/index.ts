import {
  adminClient,
  authenticate,
  checkOrigin,
  errorResponse,
  jsonResponse,
  preflightResponse,
} from "../_shared/http.ts";
import { getNextQuotaResetAt } from "../_shared/quota-window.js";

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
    const { data: quota, error: quotaError } = await adminClient
      .from("discord_audio_upload_rate_limits")
      .select("upload_timestamps")
      .eq("discord_user_id", user.id)
      .maybeSingle();
    if (quotaError) {
      console.error("Site quota reset lookup failed.", quotaError.code);
      throw new Error("Site quota reset lookup failed.");
    }
    const dashboard = data as Record<string, unknown>;
    return jsonResponse(request, {
      ...dashboard,
      nextQuotaResetAt: dashboard.isVip === true
        ? null
        : getNextQuotaResetAt(quota?.upload_timestamps),
    });
  } catch (error) {
    return errorResponse(request, error);
  }
});
