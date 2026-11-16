import {
  createEdgeAssertion,
  getDiscordSession,
  hasStrongSecret,
  jsonError,
  sameOriginError,
} from "../../_shared/auth.js";

export async function onRequestPost({ request, env }) {
  const originError = sameOriginError(request);
  if (originError) return originError;

  const session = await getDiscordSession(request, env);
  if (!session) return jsonError("Masuk dengan Discord untuk melanjutkan.", 401);

  const supabaseUrl = env.SUPABASE_URL?.trim().replace(/\/+$/, "");
  const publishableKey = env.SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!supabaseUrl || !publishableKey || !hasStrongSecret(env.AUTH_BRIDGE_SECRET)) {
    return jsonError("Konfigurasi Supabase belum diatur di Cloudflare Pages.", 503);
  }

  // Get user's Roblox config from Supabase backend
  let upstreamUrl = `${supabaseUrl}/functions/v1/roblox-status`;
  let robloxConfig = null;
  try {
    const upstream = await fetch(upstreamUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${await createEdgeAssertion(session, env)}`,
        "apikey": publishableKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({})
    });
    if (upstream.ok) {
      robloxConfig = await upstream.json();
    }
  } catch (err) {
    return jsonError(`Gagal mengambil koneksi Roblox: ${err.message}`, 500);
  }

  // Now proxy to Termux
  let targetBridge = env.TERMUX_BRIDGE_URL || request.headers.get("x-termux-bridge");
  if (!targetBridge) {
    return jsonError("TERMUX_BRIDGE_URL belum diatur.", 503);
  }

  targetBridge = targetBridge.replace(/\/$/, "");
  const reqBody = await request.json().catch(() => ({}));

  // Attach Roblox credentials if available from user's setup
  if (robloxConfig && robloxConfig.creatorId) {
    reqBody.user_id = robloxConfig.creatorId;
  }

  try {
    const bridgeResp = await fetch(`${targetBridge}/api/spoof`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(reqBody)
    });
    const bridgeData = await bridgeResp.json();
    return new Response(JSON.stringify(bridgeData), {
      status: bridgeResp.status,
      headers: { "Content-Type": "application/json" }
    });
  } catch (err) {
    return jsonError(`Termux error: ${err.message}`, 502);
  }
}
