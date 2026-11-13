export function getMembershipBadge({ signedIn, isVip, quotaRemaining }) {
  if (!signedIn) return { label: "PAKET AKUN", value: "MASUK" };
  if (isVip) return { label: "PAKET VIP", value: "UNLIMITED" };

  const validQuota = Number.isInteger(quotaRemaining)
    && quotaRemaining >= 0
    && quotaRemaining <= 5;

  return {
    label: "PAKET FREE",
    value: validQuota ? `${quotaRemaining}/5` : "—/5",
  };
}
