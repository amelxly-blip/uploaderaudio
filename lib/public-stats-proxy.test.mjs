import test from "node:test";
import assert from "node:assert/strict";
import { onRequestPost } from "../functions/api/public/stats.js";

const appOrigin = "https://uploaderaudio.pages.dev";

function requestToStats(origin = appOrigin) {
  return new Request(`${appOrigin}/api/public/stats`, {
    method: "POST",
    headers: {
      Origin: origin,
      "Content-Type": "application/json",
      Cookie: "mchlern_discord_session=private-session",
    },
    body: "{}",
  });
}

test("public stats proxy rejects cross-origin requests", async () => {
  const response = await onRequestPost({
    request: requestToStats("https://attacker.example"),
    env: {},
  });
  assert.equal(response.status, 403);
});

test("public stats proxy returns only aggregate data without forwarding browser cookies", async () => {
  const originalFetch = globalThis.fetch;
  let upstream;
  globalThis.fetch = async (input, init) => {
    upstream = { url: String(input), init: { ...init, headers: new Headers(init.headers) } };
    return Response.json({
      totalVisitors: 12,
      totalVip: 3,
      totalUploads: 41,
    });
  };

  try {
    const response = await onRequestPost({
      request: requestToStats(),
      env: {
        SUPABASE_URL: "https://example.supabase.co/",
        SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
        DISCORD_REDIRECT_URI: `${appOrigin}/api/auth/discord/callback`,
      },
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      totalVisitors: 12,
      totalVip: 3,
      totalUploads: 41,
    });
    assert.equal(upstream.url, "https://example.supabase.co/functions/v1/site-public-stats");
    assert.equal(upstream.init.headers.has("Cookie"), false);
    assert.equal(upstream.init.headers.has("Authorization"), false);
    assert.equal(upstream.init.headers.get("apikey"), "sb_publishable_test");
    assert.equal(upstream.init.headers.get("Origin"), appOrigin);
    assert.match(response.headers.get("Cache-Control"), /max-age=30/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
