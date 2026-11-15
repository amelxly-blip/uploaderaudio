import test from "node:test";
import assert from "node:assert/strict";
import {
  getSkyboxImageAssetId,
  RobloxImageIdResolutionError,
  SKYBOX_ASSET_TYPE,
  SKYBOX_UPLOAD_ASSET_TYPE,
} from "../supabase/functions/_shared/skybox-assets.js";

const decalContent = `<?xml version="1.0"?>
<roblox version="4">
  <Item class="Decal" referent="RBX0">
    <Properties>
      <Content name="Texture"><url>http://www.roblox.com/asset/?id=987654321</url></Content>
    </Properties>
  </Item>
</roblox>`;

test("Skybox upload remains a Decal while the exported ID is the linked Image ID", async () => {
  const requests = [];
  const fetchMock = async (input, init = {}) => {
    requests.push({ url: String(input), headers: new Headers(init.headers) });
    if (requests.length === 1) {
      return new Response(JSON.stringify({
        location: "https://assetdelivery.roblox.com/temp/decal.xml",
      }), { headers: { "content-type": "application/json" } });
    }
    return new Response(decalContent, { headers: { "content-type": "application/xml" } });
  };

  const imageId = await getSkyboxImageAssetId(
    { assetType: "ASSET_TYPE_DECAL", assetId: 123456789 },
    "test-api-key",
    fetchMock,
  );

  assert.equal(SKYBOX_UPLOAD_ASSET_TYPE, "Decal");
  assert.equal(SKYBOX_ASSET_TYPE, "Image");
  assert.equal(imageId, "987654321");
  assert.match(requests[0].url, /apis\.roblox\.com\/asset-delivery-api\/v1\/assetId\/123456789$/);
  assert.equal(requests[0].headers.get("x-api-key"), "test-api-key");
  assert.equal(requests[0].headers.get("assettype"), "Decal");
  assert.equal(requests[0].headers.get("assetformat"), "xml");
  assert.equal(requests[1].url, "https://assetdelivery.roblox.com/temp/decal.xml");
  assert.equal(requests[1].headers.get("x-api-key"), null);
});

test("Skybox accepts an Image ID directly if Roblox already returns an Image asset", async () => {
  const imageId = await getSkyboxImageAssetId(
    { assetType: "ASSET_TYPE_IMAGE", assetId: 123456789 },
    "test-api-key",
    async () => {
      throw new Error("Asset Delivery should not be called for Image IDs.");
    },
  );

  assert.equal(imageId, "123456789");
});

test("Skybox fails clearly when the API key cannot read the Decal content", async () => {
  await assert.rejects(
    getSkyboxImageAssetId(
      { assetType: "ASSET_TYPE_DECAL", assetId: 123456789 },
      "test-api-key",
      async () => new Response("", { status: 403 }),
    ),
    (error) => error instanceof RobloxImageIdResolutionError && /Assets: Read/.test(error.message),
  );
});

test("Skybox rejects untrusted CDN locations and Decals without an Image reference", async () => {
  await assert.rejects(
    getSkyboxImageAssetId(
      { assetType: "ASSET_TYPE_DECAL", assetId: 123456789 },
      "test-api-key",
      async () => new Response(JSON.stringify({ location: "https://example.com/decal.xml" })),
    ),
    (error) => error instanceof RobloxImageIdResolutionError,
  );

  await assert.rejects(
    getSkyboxImageAssetId(
      { assetType: "ASSET_TYPE_DECAL", assetId: 123456789 },
      "test-api-key",
      async () => new Response(JSON.stringify({
        location: "https://assetdelivery.roblox.com/temp/decal.xml",
      })),
    ),
    (error) => error instanceof RobloxImageIdResolutionError,
  );
});

test("Skybox rejects invalid Roblox operation asset types instead of using their IDs", async () => {
  await assert.rejects(
    getSkyboxImageAssetId(
      { assetType: "ASSET_TYPE_MODEL", assetId: 123456789 },
      "test-api-key",
      async () => {
        throw new Error("Asset Delivery should not be called for an invalid type.");
      },
    ),
    (error) => error instanceof RobloxImageIdResolutionError,
  );
});
