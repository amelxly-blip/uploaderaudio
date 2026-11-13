import test from "node:test";
import assert from "node:assert/strict";
import { getMembershipBadge } from "../src/membership-badge.js";

test("free membership badge shows remaining quota out of five", () => {
  assert.deepEqual(getMembershipBadge({
    signedIn: true,
    isVip: false,
    quotaRemaining: 5,
  }), {
    label: "PAKET FREE",
    value: "5/5",
  });

  assert.deepEqual(getMembershipBadge({
    signedIn: true,
    isVip: false,
    quotaRemaining: 4,
  }), {
    label: "PAKET FREE",
    value: "4/5",
  });
});

test("VIP and guest badges do not display a free quota", () => {
  assert.deepEqual(getMembershipBadge({
    signedIn: true,
    isVip: true,
    quotaRemaining: null,
  }), {
    label: "PAKET VIP",
    value: "UNLIMITED",
  });

  assert.deepEqual(getMembershipBadge({
    signedIn: false,
    isVip: false,
    quotaRemaining: null,
  }), {
    label: "PAKET AKUN",
    value: "MASUK",
  });
});

test("invalid free quota values are not rendered as valid counts", () => {
  assert.deepEqual(getMembershipBadge({
    signedIn: true,
    isVip: false,
    quotaRemaining: 6,
  }), {
    label: "PAKET FREE",
    value: "—/5",
  });
});
