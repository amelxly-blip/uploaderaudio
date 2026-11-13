import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("site image policy allows Roblox avatar thumbnails", async () => {
  const headers = await readFile(new URL("../public/_headers", import.meta.url), "utf8");
  const policy = headers
    .split(/\r?\n/)
    .find((line) => line.trim().startsWith("Content-Security-Policy:"));
  const imageSources = policy?.split(";")
    .map((directive) => directive.trim())
    .find((directive) => directive.startsWith("img-src "));

  assert.ok(imageSources, "CSP must define an img-src directive");
  assert.ok(imageSources.includes("https://*.rbxcdn.com"));
});
