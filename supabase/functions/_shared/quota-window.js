const QUOTA_WINDOW_MS = 24 * 60 * 60 * 1000;

export function getNextQuotaResetAt(timestamps, now = Date.now()) {
  if (!Array.isArray(timestamps)) return null;

  const oldestRecentTimestamp = timestamps
    .map((timestamp) =>
      typeof timestamp === "string" ? Date.parse(timestamp) : NaN
    )
    .filter((timestamp) =>
      Number.isFinite(timestamp) && timestamp > now - QUOTA_WINDOW_MS
    )
    .sort((left, right) => left - right)[0];

  if (oldestRecentTimestamp === undefined) return null;
  const resetAt = oldestRecentTimestamp + QUOTA_WINDOW_MS;
  return resetAt > now ? new Date(resetAt).toISOString() : null;
}
