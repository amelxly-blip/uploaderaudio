import {
  jsonError,
  sameOriginError,
} from "../../_shared/auth.js";

export async function onRequestPost({ request, env }) {
  const originError = sameOriginError(request);
  if (originError) return originError;

  const supabaseUrl = env.SUPABASE_URL?.trim().replace(/\/+$/, "");
  const publishableKey = env.SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!supabaseUrl || !publishableKey) {
    return jsonError("Konfigurasi Supabase belum diatur di Cloudflare Pages.", 503);
  }

  let upstreamUrl;
  let appOrigin;
  try {
    upstreamUrl = new URL(`${supabaseUrl}/functions/v1/site-public-stats`);
    const localHost = ["localhost", "127.0.0.1"].includes(upstreamUrl.hostname);
    if (upstreamUrl.protocol !== "https:" && !(localHost && upstreamUrl.protocol === "http:")) {
      throw new Error("Supabase URL must use HTTPS.");
    }
    const redirectUrl = new URL(env.DISCORD_REDIRECT_URI);
    const redirectLocalHost = ["localhost", "127.0.0.1"].includes(redirectUrl.hostname);
    if (redirectUrl.protocol !== "https:" && !(redirectLocalHost && redirectUrl.protocol === "http:")) {
      throw new Error("Discord redirect URI must use HTTPS.");
    }
    appOrigin = redirectUrl.origin;
  } catch {
    return jsonError("Konfigurasi URL Cloudflare atau Supabase tidak valid.", 503);
  }

  try {
    const upstream = await fetch(upstreamUrl, {
      method: "POST",
      headers: {
        "apikey": publishableKey,
        "Content-Type": "application/json",
        "Origin": appOrigin,
      },
      body: "{}",
      redirect: "manual",
    });
    const headers = new Headers(upstream.headers);
    headers.set("Cache-Control", "public, max-age=30, stale-while-revalidate=30");
    headers.delete("Set-Cookie");
    return new Response(upstream.body, {
      status: upstream.status,
      headers,
    });
  } catch (error) {
    console.error("Public site statistics proxy failed.", error);
    return jsonError("Statistik situs sementara tidak bisa dimuat.", 502);
  }
}
