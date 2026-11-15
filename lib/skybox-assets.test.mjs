import test from "node:test";
import assert from "node:assert/strict";
import {
  createSkyboxAssetRequest,
  createSkyboxDiagnostic,
  canRetrySkyboxImageResolution,
  extractDecalImageAssetId,
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

test("Skybox creates Image assets and uses their returned IDs directly", async () => {
  const request = createSkyboxAssetRequest("Sunset Ft", { groupId: 456 });
  const imageId = await getSkyboxImageAssetId(
    { assetType: "ASSET_TYPE_IMAGE", assetId: 123456789 },
    "test-api-key",
    async () => {
      throw new Error("Asset Delivery must not be called for Image assets.");
    },
  );

  assert.equal(request.assetType, "Image");
  assert.equal(request.creationContext.creator.groupId, 456);
  assert.equal(SKYBOX_ASSET_TYPE, "Image");
  assert.equal(SKYBOX_UPLOAD_ASSET_TYPE, "Image");
  assert.equal(imageId, "123456789");
});

test("Skybox resolves Image ID when Roblox operation uses the Decal display name", async () => {
  const fetchMock = async (input) => {
    if (String(input).includes("/assetId/123456789")) {
      return new Response(JSON.stringify({
        location: "https://assetdelivery.roblox.com/temp/decal.xml",
      }), { headers: { "content-type": "application/json" } });
    }
    return new Response(decalContent, { headers: { "content-type": "application/xml" } });
  };

  const imageId = await getSkyboxImageAssetId(
    { assetType: "Decal", assetId: 123456789 },
    "test-api-key",
    fetchMock,
  );

  assert.equal(imageId, "987654321");
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

test("Skybox accepts the Image display name from the Roblox operation response", async () => {
  const imageId = await getSkyboxImageAssetId(
    { assetType: "Image", assetId: 123456789 },
    "test-api-key",
    async () => {
      throw new Error("Asset Delivery should not be called for Image IDs.");
    },
  );

  assert.equal(imageId, "123456789");
});

test("Skybox explains that Open Cloud API keys cannot read legacy Decal content", async () => {
  let resolutionError;
  await assert.rejects(
    getSkyboxImageAssetId(
      { assetType: "ASSET_TYPE_DECAL", assetId: 123456789 },
      "test-api-key",
      async () => new Response("", { status: 403 }),
    ),
    (error) => {
      resolutionError = error;
      return error instanceof RobloxImageIdResolutionError
        && /API key Open Cloud tidak berlaku untuk endpoint ini/.test(error.message);
    },
  );
  assert.equal(resolutionError.stage, "asset-delivery-request");
  assert.equal(resolutionError.code, "asset_delivery_permission_denied");
  assert.equal(resolutionError.httpStatus, 403);
});

test("Skybox reports the number of Image ID candidates found in Decal XML", () => {
  assert.throws(
    () => extractDecalImageAssetId("<roblox><Item class=\"Decal\" /></roblox>"),
    (error) => error instanceof RobloxImageIdResolutionError
      && error.stage === "image-id-extraction"
      && error.code === "image_id_not_unique"
      && error.context.candidateCount === 0,
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

test("Skybox reports which operation-response fields prevented Image ID resolution", async () => {
  let resolutionError;
  await assert.rejects(
    getSkyboxImageAssetId(
      { assetType: "Model", assetId: 123456789 },
      "test-api-key",
      async () => {
        throw new Error("Asset Delivery should not be called for an unrecognized asset type.");
      },
    ),
    (error) => {
      resolutionError = error;
      return error instanceof RobloxImageIdResolutionError
      && error.stage === "operation-response"
      && error.code === "unexpected_asset_type"
      && error.context.assetType === "Model"
      && error.context.hasAssetId;
    },
  );

  const diagnostic = createSkyboxDiagnostic(
    resolutionError,
    "123e4567-e89b-12d3-a456-426614174000",
    { assetType: "Model", assetId: 123456789, apiKey: "must-not-be-included" },
  );
  assert.deepEqual(diagnostic, {
    diagnosticId: "123e4567-e89b-12d3-a456-426614174000",
    stage: "operation-response",
    code: "unexpected_asset_type",
    httpStatus: null,
    assetType: "Model",
    assetIdPresent: true,
  });
  assert.doesNotMatch(JSON.stringify(diagnostic), /must-not-be-included|123456789/);
});

test("failed Skybox operations can retry Image ID resolution without reuploading", () => {
  const failedOperation = {
    status: "failed",
    asset_type: "Image",
    operation_path: "operations/operation-id",
  };

  assert.equal(canRetrySkyboxImageResolution(failedOperation, true), true);
});

test("Skybox retry requires explicit intent and a valid Image operation path", () => {
  const failedOperation = {
    status: "failed",
    asset_type: "Image",
    operation_path: "operations/operation-id",
  };

  assert.equal(canRetrySkyboxImageResolution(failedOperation, false), false);
  assert.equal(canRetrySkyboxImageResolution({ ...failedOperation, asset_type: "Audio" }, true), false);
  assert.equal(canRetrySkyboxImageResolution({ ...failedOperation, operation_path: "" }, true), false);
  assert.equal(canRetrySkyboxImageResolution({
    ...failedOperation,
    error_message: "Roblox Asset Delivery menolak membaca konten Decal.",
  }, true), false);
});
