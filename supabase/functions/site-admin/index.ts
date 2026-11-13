import {
  adminClient,
  authenticateAdmin,
  checkOrigin,
  errorResponse,
  HttpResponseError,
  jsonResponse,
  preflightResponse,
  readBoundedBody,
} from "../_shared/http.ts";

const DISCORD_ID_PATTERN = /^[0-9]{17,20}$/;

type AdminAction =
  | { action: "login_attempt"; addressHash: string; reset?: boolean }
  | { action: "overview" }
  | { action: "grant_vip"; discordUserId: string; durationDays: number }
  | { action: "revoke_vip"; discordUserId: string }
  | { action: "ban_user"; discordUserId: string; reason?: string }
  | { action: "unban_user"; discordUserId: string };

function assertQuery<T>(
  label: string,
  result: { data: T | null; error: { code?: string } | null },
): T {
  if (result.error || result.data === null) {
    console.error(`${label} failed.`, result.error?.code);
    throw new Error(`${label} failed.`);
  }
  return result.data;
}

async function readAction(request: Request): Promise<AdminAction> {
  const bytes = await readBoundedBody(request, 4096, {
    tooLarge: "Permintaan terlalu besar.",
    empty: "Permintaan tidak valid.",
  });
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new HttpResponseError(400, "Format permintaan tidak valid.");
  }

  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new HttpResponseError(400, "Format permintaan tidak valid.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpResponseError(400, "Format permintaan tidak valid.");
  }
  return value as AdminAction;
}

async function loadOverview(request: Request): Promise<Response> {
  const now = new Date();
  const onlineSince = new Date(now.getTime() - 90_000).toISOString();
  const [
    statsResult,
    vipResult,
    onlineResult,
    vipListResult,
    bansResult,
  ] = await Promise.all([
    adminClient
      .from("site_global_stats")
      .select("unique_visitors,successful_uploads")
      .eq("id", 1)
      .single(),
    adminClient
      .from("site_vip_entitlements")
      .select("discord_user_id", { count: "exact", head: true })
      .gt("expires_at", now.toISOString()),
    adminClient
      .from("site_discord_visitors")
      .select("discord_user_id,username,display_name,avatar_url,last_seen_at")
      .gte("last_seen_at", onlineSince)
      .order("last_seen_at", { ascending: false })
      .limit(100),
    adminClient
      .from("site_vip_entitlements")
      .select("discord_user_id,granted_at,expires_at")
      .gt("expires_at", now.toISOString())
      .order("expires_at", { ascending: true })
      .limit(100),
    adminClient
      .from("site_user_bans")
      .select("discord_user_id,banned_at,reason")
      .order("banned_at", { ascending: false })
      .limit(100),
  ]);
  const stats = assertQuery("Site statistics", statsResult);
  if (vipResult.error) {
    console.error("VIP count failed.", vipResult.error.code);
    throw new Error("VIP count failed.");
  }
  const totalVip = vipResult.count ?? 0;
  const onlineUsers = assertQuery("Online users", onlineResult);
  const vipMembers = assertQuery("VIP members", vipListResult);
  const bannedUsers = assertQuery("Banned users", bansResult);
  const ids = [
    ...new Set([
      ...vipMembers.map((member) => member.discord_user_id),
      ...bannedUsers.map((member) => member.discord_user_id),
    ]),
  ];
  const profileResult = ids.length
    ? await adminClient
      .from("site_discord_visitors")
      .select("discord_user_id,username,display_name,avatar_url")
      .in("discord_user_id", ids)
    : { data: [], error: null };
  const profiles = assertQuery("Admin profile lookup", profileResult);
  const profileById = new Map(
    profiles.map((profile) => [profile.discord_user_id, profile]),
  );
  const decorate = <T extends { discord_user_id: string }>(record: T) => ({
    ...profileById.get(record.discord_user_id),
    ...record,
  });

  return jsonResponse(request, {
    totalVisitors: stats.unique_visitors,
    totalVip,
    totalUploads: stats.successful_uploads,
    onlineUsers,
    vipMembers: vipMembers.map(decorate),
    bannedUsers: bannedUsers.map(decorate),
  });
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return preflightResponse(request);
  if (request.method !== "POST") {
    return jsonResponse(request, { error: "Metode tidak didukung." }, 405);
  }
  const originError = checkOrigin(request);
  if (originError) return originError;

  try {
    await authenticateAdmin(request);
    const body = await readAction(request);
    if (body.action === "overview") return await loadOverview(request);
    if (body.action === "login_attempt") {
      if (
        typeof body.addressHash !== "string" ||
        !/^[0-9a-f]{64}$/.test(body.addressHash)
      ) {
        throw new HttpResponseError(400, "Fingerprint login tidak valid.");
      }
      if (body.reset === true) {
        const { error } = await adminClient.rpc(
          "reset_site_admin_login_attempts",
          {
            p_address_hash: body.addressHash,
          },
        );
        if (error) {
          console.error("Admin login limit reset failed.", error.code);
          throw new Error("Admin login limit reset failed.");
        }
        return jsonResponse(request, { allowed: true });
      }
      const { data, error } = await adminClient.rpc(
        "consume_site_admin_login_attempt",
        {
          p_address_hash: body.addressHash,
        },
      );
      if (error) {
        console.error("Admin login limit check failed.", error.code);
        throw new Error("Admin login limit check failed.");
      }
      return jsonResponse(request, { allowed: data });
    }

    if (
      !("discordUserId" in body) ||
      typeof body.discordUserId !== "string" ||
      !DISCORD_ID_PATTERN.test(body.discordUserId)
    ) {
      throw new HttpResponseError(
        400,
        "Discord ID harus berupa ID numerik yang valid.",
      );
    }

    if (body.action === "grant_vip") {
      if (![7, 30, 60].includes(body.durationDays)) {
        throw new HttpResponseError(400, "Pilih masa VIP 7, 30, atau 60 hari.");
      }
      const { data, error } = await adminClient.rpc("grant_site_vip", {
        p_discord_user_id: body.discordUserId,
        p_duration_days: body.durationDays,
      });
      if (error) {
        console.error("VIP grant failed.", error.code);
        throw new Error("VIP grant failed.");
      }
      return jsonResponse(request, { expiresAt: data });
    }

    if (body.action === "revoke_vip") {
      const { data, error } = await adminClient.rpc("revoke_site_vip", {
        p_discord_user_id: body.discordUserId,
      });
      if (error) {
        console.error("VIP revoke failed.", error.code);
        throw new Error("VIP revoke failed.");
      }
      return jsonResponse(request, { removed: data });
    }

    if (body.action === "ban_user") {
      const reason = typeof body.reason === "string" ? body.reason.trim() : "";
      if (reason.length > 200) {
        throw new HttpResponseError(400, "Alasan ban maksimal 200 karakter.");
      }
      const { error } = await adminClient.rpc("ban_site_discord_user", {
        p_discord_user_id: body.discordUserId,
        p_reason: reason || "Aturan komunitas",
      });
      if (error) {
        console.error("Discord ban failed.", error.code);
        throw new Error("Discord ban failed.");
      }
      return jsonResponse(request, { banned: true });
    }

    if (body.action === "unban_user") {
      const { data, error } = await adminClient.rpc("unban_site_discord_user", {
        p_discord_user_id: body.discordUserId,
      });
      if (error) {
        console.error("Discord unban failed.", error.code);
        throw new Error("Discord unban failed.");
      }
      return jsonResponse(request, { removed: data });
    }

    throw new HttpResponseError(400, "Aksi admin tidak dikenal.");
  } catch (error) {
    return errorResponse(request, error);
  }
});
