import {
  adminClient,
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
    const [statsResult, vipResult] = await Promise.all([
      adminClient
        .from("site_global_stats")
        .select("unique_visitors,successful_uploads")
        .eq("id", 1)
        .single(),
      adminClient
        .from("site_vip_entitlements")
        .select("discord_user_id", { count: "exact", head: true })
        .gt("expires_at", new Date().toISOString()),
    ]);
    if (statsResult.error) {
      console.error("Public site statistics failed.", statsResult.error.code);
      throw new Error("Public site statistics failed.");
    }
    if (vipResult.error) {
      console.error("Public VIP count failed.", vipResult.error.code);
      throw new Error("Public VIP count failed.");
    }
    return jsonResponse(request, {
      totalVisitors: statsResult.data.unique_visitors,
      totalVip: vipResult.count ?? 0,
      totalUploads: statsResult.data.successful_uploads,
    });
  } catch (error) {
    return errorResponse(request, error);
  }
});
