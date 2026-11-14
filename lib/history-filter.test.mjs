import test from "node:test";
import assert from "node:assert/strict";
import { filterUploadHistory } from "../src/history-filter.js";

const uploads = [
  { display_name: "Rain Ambience", asset_type: "Audio", asset_id: "10001" },
  { display_name: "Night Logo", asset_type: "Decal", asset_id: "20002" },
  { display_name: "Wood Cabin", asset_type: "Model", asset_id: "30003" },
];

test("history search matches asset names and IDs without case sensitivity", () => {
  assert.deepEqual(filterUploadHistory(uploads, { query: "RAIN" }), [uploads[0]]);
  assert.deepEqual(filterUploadHistory(uploads, { query: "20002" }), [uploads[1]]);
});

test("history type filter composes with the search query", () => {
  assert.deepEqual(filterUploadHistory(uploads, { assetType: "Model" }), [uploads[2]]);
  assert.deepEqual(filterUploadHistory(uploads, { query: "night", assetType: "Audio" }), []);
});
