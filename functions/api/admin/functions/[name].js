import {
  createAdminEdgeAssertion,
  getAdminSession,
  hasStrongSecret,
  jsonError,
  sameOriginError,
} from "../../../_shared/auth.js";

export async function onRequestPost({ request, env, params }) {
  const originError = sameOriginError(request);
  if (originError) return originError;
  if (params.name !== "site-admin") return jsonError("Endpoint tidak ditemukan.", 404);
  if (!await getAdminSession(request, env)) return jsonError("Login admin diperlukan.", 401);

  const supabaseUrl = env.SUPABASE_URL?.trim().replace(/\/+$/, "");
  const publishableKey = env.SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!supabaseUrl || !publishableKey || !hasStrongSecret(env.AUTH_BRIDGE_SECRET)) {
    return jsonError("Konfigurasi Supabase belum diatur di Cloudflare Pages.", 503);
  }

  let upstreamUrl;
  try {
    upstreamUrl = new URL(`${supabaseUrl}/functions/v1/site-admin`);
    if (upstreamUrl.protocol !== "https:") throw new Error("Supabase URL must use HTTPS.");
  } catch {
    return jsonError("URL Supabase di Cloudflare tidak valid.", 503);
  }

  try {
    const headers = new Headers({
      "Authorization": `Bearer ${await createAdminEdgeAssertion(env)}`,
      "apikey": publishableKey,
      "Content-Type": "application/json",
      "Origin": new URL(request.url).origin,
    });
    const upstream = await fetch(upstreamUrl, {
      method: "POST",
      headers,
      body: request.body,
      redirect: "manual",
    });
    const responseHeaders = new Headers(upstream.headers);
    responseHeaders.set("Cache-Control", "no-store");
    responseHeaders.delete("Set-Cookie");
    return new Response(upstream.body, {
      status: upstream.status,
      headers: responseHeaders,
    });
  } catch (error) {
    console.error("Supabase admin proxy failed.", error);
    return jsonError("Layanan admin sementara tidak bisa dijangkau.", 502);
  }
}
