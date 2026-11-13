import {
  createEdgeAssertion,
  getDiscordSession,
  hasStrongSecret,
  jsonError,
  sameOriginError,
} from "../../_shared/auth.js";

const ALLOWED_FUNCTIONS = new Set([
  "roblox-history",
  "roblox-operation",
  "roblox-status",
  "roblox-upload",
]);

export async function onRequestPost({ request, env, params }) {
  const originError = sameOriginError(request);
  if (originError) return originError;

  const functionName = params.name;
  if (!ALLOWED_FUNCTIONS.has(functionName)) {
    return jsonError("Endpoint tidak ditemukan.", 404);
  }

  const session = await getDiscordSession(request, env);
  if (!session) return jsonError("Masuk dengan Discord untuk melanjutkan.", 401);

  const supabaseUrl = env.SUPABASE_URL?.trim().replace(/\/+$/, "");
  const publishableKey = env.SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!supabaseUrl || !publishableKey || !hasStrongSecret(env.AUTH_BRIDGE_SECRET)) {
    return jsonError("Konfigurasi Supabase belum diatur di Cloudflare Pages.", 503);
  }

  let upstreamUrl;
  try {
    upstreamUrl = new URL(`${supabaseUrl}/functions/v1/${functionName}`);
    const localHost = ["localhost", "127.0.0.1"].includes(upstreamUrl.hostname);
    if (upstreamUrl.protocol !== "https:" && !(localHost && upstreamUrl.protocol === "http:")) {
      throw new Error("Supabase URL must use HTTPS.");
    }
  } catch {
    return jsonError("URL Supabase di Cloudflare Pages tidak valid.", 503);
  }

  try {
    const headers = new Headers();
    for (const name of ["Origin", "Content-Type", "x-audio-name", "x-audio-filename"]) {
      const value = request.headers.get(name);
      if (value) headers.set(name, value);
    }
    headers.set("Authorization", `Bearer ${await createEdgeAssertion(session, env)}`);
    headers.set("apikey", publishableKey);

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
    console.error("Supabase Edge Function proxy failed.", error);
    return jsonError("Layanan uploader sementara tidak bisa dijangkau.", 502);
  }
}
