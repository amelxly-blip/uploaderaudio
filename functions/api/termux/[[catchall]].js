export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  // Subpath after /api/termux/
  const subpath = url.pathname.replace(/^\/api\/termux/, "") || "/api/ping";

  // Check bridge target: can be set via Cloudflare environment variable TERMUX_BRIDGE_URL
  // or via request header x-termux-bridge or query param bridge_url
  let targetBridge = env.TERMUX_BRIDGE_URL || url.searchParams.get("bridge_url");

  // Fallback to cookie/header
  if (!targetBridge) {
    targetBridge = request.headers.get("x-termux-bridge");
  }

  // If still not configured
  if (!targetBridge) {
    return new Response(JSON.stringify({
      ok: false,
      error: "TERMUX_BRIDGE_URL belum dikonfigurasi di Cloudflare Pages atau settingan admin."
    }), {
      status: 503,
      headers: { "Content-Type": "application/json" }
    });
  }

  targetBridge = targetBridge.replace(/\/$/, "");
  const targetUrl = `${targetBridge}${subpath}${url.search}`;

  try {
    const init = {
      method: request.method,
      headers: {
        "Content-Type": request.headers.get("Content-Type") || "application/json",
      }
    };

    if (request.method !== "GET" && request.method !== "HEAD") {
      init.body = await request.arrayBuffer();
    }

    const response = await fetch(targetUrl, init);
    const body = await response.arrayBuffer();

    return new Response(body, {
      status: response.status,
      headers: {
        "Content-Type": response.headers.get("Content-Type") || "application/json",
        "Access-Control-Allow-Origin": "*"
      }
    });
  } catch (err) {
    return new Response(JSON.stringify({
      ok: false,
      error: `Gagal meneruskan request ke Termux: ${err.message}`
    }), {
      status: 502,
      headers: { "Content-Type": "application/json" }
    });
  }
}
