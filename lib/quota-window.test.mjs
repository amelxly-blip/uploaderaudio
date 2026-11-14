import test from "node:test";
import assert from "node:assert/strict";
import { getNextQuotaResetAt } from "../supabase/functions/_shared/quota-window.js";

const now = Date.parse("2026-11-14T09:00:00.000Z");

test("the next slot returns 24 hours after the oldest recent upload", () => {
  assert.equal(
    getNextQuotaResetAt([
      "2026-11-14T08:30:00.000Z",
      "2026-11-14T08:45:00.000Z",
    ], now),
    "2026-11-15T08:30:00.000Z",
  );
});

test("expired and invalid timestamps do not create a reset countdown", () => {
  assert.equal(
    getNextQuotaResetAt(["2026-11-13T08:59:59.999Z", "not-a-date"], now),
    null,
  );
  assert.equal(getNextQuotaResetAt(null, now), null);
});
