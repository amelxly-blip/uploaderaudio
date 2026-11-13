import test from "node:test";
import assert from "node:assert/strict";
import { getCompensationSpeed } from "../src/audio-processing.js";

test("Roblox PlaybackSpeed 0.43 is compensated by speeding the uploaded audio about 2.33x", () => {
  assert.ok(Math.abs(getCompensationSpeed(0.43) - 2.3255813953) < 0.000001);
});

test("normal Roblox playback does not change uploaded audio speed", () => {
  assert.equal(getCompensationSpeed(1), 1);
});

test("audio compensation rejects values outside supported Roblox playback range", () => {
  assert.throws(() => getCompensationSpeed(0.24), RangeError);
  assert.throws(() => getCompensationSpeed(1.01), RangeError);
  assert.throws(() => getCompensationSpeed(Number.NaN), RangeError);
});
