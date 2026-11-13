import {
  adminClient,
  authenticate,
  checkOrigin,
  errorResponse,
  jsonResponse,
  preflightResponse,
  requireAuthorized,
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
    await requireAuthorized(user.id);
    const { data, error } = await adminClient
      .from("audio_uploads")
      .select("id,display_name,file_size,status,asset_id,error_message,created_at")
      .eq("discord_user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error("Could not retrieve upload history.");
    return jsonResponse(request, { uploads: data });
  } catch (error) {
    return errorResponse(request, error);
  }
});
