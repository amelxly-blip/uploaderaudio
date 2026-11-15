import test from "node:test";
import assert from "node:assert/strict";
import { onRequestGet } from "../functions/api/roblox-thumbnail.js";

test("thumbnail proxy rejects malformed asset IDs without calling Roblox", async () => {
  const response = await onRequestGet({
    request: new Request("https://uploaderaudio.pages.dev/api/roblox-thumbnail?assetId=123%26url%3Dhttps://attacker.example"),
  });

  assert.equal(response.status, 400);
});

test("thumbnail proxy fetches a preview from Roblox and returns the image bytes", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  const imageBytes = new Uint8Array([137, 80, 78, 71]);
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    calls.push({ url, init });
    assert.equal(init.redirect, "error");
    if (url.origin === "https://thumbnails.roblox.com") {
      return Response.json({ data: [{ imageUrl: "https://tr.rbxcdn.com/image.png" }] });
    }
    return new Response(imageBytes, { headers: { "Content-Type": "image/png" } });
  };

  try {
    const response = await onRequestGet({
      request: new Request("https://uploaderaudio.pages.dev/api/roblox-thumbnail?assetId=12345"),
    });

    assert.equal(calls[0].url.origin, "https://thumbnails.roblox.com");
    assert.equal(calls[0].url.pathname, "/v1/assets");
    assert.equal(calls[0].url.searchParams.get("assetIds"), "12345");
    assert.equal(calls[1].url.href, "https://tr.rbxcdn.com/image.png");
    assert.equal(response.headers.get("Content-Type"), "image/png");
    assert.equal(response.headers.get("Cache-Control"), "public, max-age=300");
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), imageBytes);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("thumbnail proxy rejects URLs outside Roblox's CDN", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount += 1;
    return Response.json({ data: [{ imageUrl: "https://attacker.example/image.png" }] });
  };

  try {
    const response = await onRequestGet({
      request: new Request("https://uploaderaudio.pages.dev/api/roblox-thumbnail?assetId=12345"),
    });
    assert.equal(response.status, 502);
    assert.equal(fetchCount, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
