import { decryptApiKey, encryptApiKey } from "./credential-encryption.js";
import { adminClient, HttpResponseError } from "./http.ts";

type CreatorType = "user" | "group";

export interface RobloxConfig {
  apiKey: string;
  creator: { userId: number } | { groupId: number };
  creatorType: CreatorType;
  creatorId: string;
  label: string;
}

export interface RobloxCreatorProfile {
  username: string;
  displayName: string;
  avatarUrl: string;
}

interface CredentialInput {
  creatorType: CreatorType;
  creatorId: string;
  apiKey: string;
}

const API_KEY_MAX_LENGTH = 4096;

function logCredentialFailure(operation: string, error?: unknown): void {
  const candidate = error && typeof error === "object" && "code" in error
    ? error.code
    : undefined;
  const code = typeof candidate === "string" && /^[A-Z0-9_]+$/.test(candidate)
    ? candidate
    : "unknown";
  console.error("[roblox-credentials] operation failed", { operation, code });
}

function encryptionSecret(): string {
  const secret = Deno.env.get("AUTH_BRIDGE_SECRET") ?? "";
  if (new TextEncoder().encode(secret).byteLength < 32) {
    throw new HttpResponseError(503, "Penyimpanan API key belum siap. Hubungi pengelola.");
  }
  return secret;
}

function creatorLabel(creatorType: CreatorType, creatorId: string): string {
  return `${creatorType === "group" ? "Group" : "User"} · ${creatorId}`;
}

async function fetchRobloxJson(url: string): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(8000) });
  } catch {
    throw new HttpResponseError(502, "Profil Roblox tidak bisa dimuat. Coba lagi sebentar.");
  }
  if (response.status === 404) {
    throw new HttpResponseError(422, "Creator ID Roblox tidak ditemukan.");
  }
  if (!response.ok) {
    throw new HttpResponseError(502, "Roblox gagal memuat profil creator. Coba lagi sebentar.");
  }
  const data = await response.json().catch(() => null);
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new HttpResponseError(502, "Roblox mengembalikan profil creator yang tidak valid.");
  }
  return data as Record<string, unknown>;
}

export async function getRobloxCreatorProfile(
  creatorType: CreatorType,
  creatorId: string,
): Promise<RobloxCreatorProfile> {
  if (
    (creatorType !== "user" && creatorType !== "group")
    || !/^[1-9][0-9]{0,15}$/.test(creatorId)
    || !Number.isSafeInteger(Number(creatorId))
  ) {
    throw new HttpResponseError(400, "Creator Roblox tidak valid.");
  }

  const endpoint = creatorType === "group"
    ? `https://groups.roblox.com/v1/groups/${creatorId}`
    : `https://users.roblox.com/v1/users/${creatorId}`;
  const thumbnailEndpoint = creatorType === "group"
    ? `https://thumbnails.roblox.com/v1/groups/icons?groupIds=${creatorId}&size=150x150&format=Png&isCircular=false`
    : `https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${creatorId}&size=150x150&format=Png&isCircular=false`;
  const [profile, thumbnails] = await Promise.all([
    fetchRobloxJson(endpoint),
    fetchRobloxJson(thumbnailEndpoint),
  ]);
  const name = typeof profile.name === "string" ? profile.name : "";
  const displayName = typeof profile.displayName === "string" ? profile.displayName : name;
  const data = Array.isArray(thumbnails.data) ? thumbnails.data[0] : null;
  let avatarUrl = "";
  if (data && typeof data === "object" && "imageUrl" in data && typeof data.imageUrl === "string") {
    try {
      const imageUrl = new URL(data.imageUrl);
      if (imageUrl.protocol === "https:" && imageUrl.hostname.endsWith(".rbxcdn.com")) {
        avatarUrl = imageUrl.href;
      }
    } catch {
      avatarUrl = "";
    }
  }
  if (!name || !displayName) {
    throw new HttpResponseError(502, "Roblox tidak mengembalikan nama profil creator.");
  }
  return { username: name, displayName, avatarUrl };
}

function parseCredentialInput(body: unknown): CredentialInput {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpResponseError(400, "Konfigurasi Roblox tidak valid.");
  }
  const input = body as Record<string, unknown>;
  const creatorType = input.creatorType;
  const creatorId = typeof input.creatorId === "string" ? input.creatorId.trim() : "";
  const apiKey = typeof input.apiKey === "string" ? input.apiKey.trim() : "";
  const numericId = Number(creatorId);

  if (creatorType !== "user" && creatorType !== "group") {
    throw new HttpResponseError(400, "Pilih jenis creator Roblox yang valid.");
  }
  if (!/^[1-9][0-9]{0,15}$/.test(creatorId) || !Number.isSafeInteger(numericId)) {
    throw new HttpResponseError(400, "Creator ID harus berupa angka Roblox yang valid.");
  }
  if (apiKey.length > API_KEY_MAX_LENGTH || /[\u0000-\u001f\u007f]/.test(apiKey)) {
    throw new HttpResponseError(400, "API key tidak valid.");
  }

  return { creatorType, creatorId, apiKey };
}

export async function getUserRobloxConfig(discordUserId: string): Promise<RobloxConfig | null> {
  const { data, error } = await adminClient
    .from("discord_roblox_credentials")
    .select("creator_type,creator_id,api_key_ciphertext,api_key_nonce")
    .eq("discord_user_id", discordUserId)
    .maybeSingle();
  if (error) {
    logCredentialFailure("read", error);
    throw new Error("Could not retrieve saved Roblox credentials.");
  }
  if (!data) return null;

  const creatorType = data.creator_type;
  const creatorId = data.creator_id;
  if (
    (creatorType !== "user" && creatorType !== "group")
    || typeof creatorId !== "string"
    || !/^[1-9][0-9]{0,15}$/.test(creatorId)
    || !Number.isSafeInteger(Number(creatorId))
  ) {
    throw new Error("Stored Roblox creator configuration is invalid.");
  }

  let apiKey: string;
  try {
    apiKey = await decryptApiKey(
      data.api_key_ciphertext,
      data.api_key_nonce,
      encryptionSecret(),
      discordUserId,
    );
  } catch (error) {
    if (error instanceof HttpResponseError) throw error;
    throw new HttpResponseError(
      409,
      "API key tersimpan tidak bisa dibuka. Masukkan ulang API key di halaman Setup.",
    );
  }
  if (!apiKey) {
    throw new HttpResponseError(409, "API key tersimpan tidak valid. Masukkan ulang API key di halaman Setup.");
  }

  const numericId = Number(creatorId);
  const creator = creatorType === "group" ? { groupId: numericId } : { userId: numericId };
  return {
    apiKey,
    creator,
    creatorType,
    creatorId,
    label: creatorLabel(creatorType, creatorId),
  };
}

export async function saveUserRobloxConfig(discordUserId: string, body: unknown): Promise<{
  creatorType: CreatorType;
  creatorId: string;
  creatorLabel: string;
  profile: RobloxCreatorProfile;
}> {
  const input = parseCredentialInput(body);
  const { data: existing, error: lookupError } = await adminClient
    .from("discord_roblox_credentials")
    .select("discord_user_id")
    .eq("discord_user_id", discordUserId)
    .maybeSingle();
  if (lookupError) {
    logCredentialFailure("check-existing", lookupError);
    throw new Error("Could not check existing Roblox credentials.");
  }

  if (!input.apiKey && !existing) {
    throw new HttpResponseError(400, "Masukkan API key Roblox untuk konfigurasi pertama.");
  }
  const profile = await getRobloxCreatorProfile(input.creatorType, input.creatorId);

  const updatedAt = new Date().toISOString();
  if (input.apiKey) {
    let encrypted: Awaited<ReturnType<typeof encryptApiKey>>;
    try {
      encrypted = await encryptApiKey(input.apiKey, encryptionSecret(), discordUserId);
    } catch (error) {
      logCredentialFailure("encrypt");
      throw error;
    }
    const { error } = await adminClient
      .from("discord_roblox_credentials")
      .upsert({
        discord_user_id: discordUserId,
        creator_type: input.creatorType,
        creator_id: input.creatorId,
        api_key_ciphertext: encrypted.ciphertext,
        api_key_nonce: encrypted.nonce,
        updated_at: updatedAt,
      });
    if (error) {
      logCredentialFailure("insert-or-update", error);
      throw new Error("Could not save encrypted Roblox credentials.");
    }
  } else {
    const { error } = await adminClient
      .from("discord_roblox_credentials")
      .update({
        creator_type: input.creatorType,
        creator_id: input.creatorId,
        updated_at: updatedAt,
      })
      .eq("discord_user_id", discordUserId);
    if (error) {
      logCredentialFailure("update-creator", error);
      throw new Error("Could not update Roblox creator configuration.");
    }
  }

  return {
    creatorType: input.creatorType,
    creatorId: input.creatorId,
    creatorLabel: creatorLabel(input.creatorType, input.creatorId),
    profile,
  };
}

export async function deleteUserRobloxConfig(discordUserId: string): Promise<void> {
  const { error } = await adminClient
    .from("discord_roblox_credentials")
    .delete()
    .eq("discord_user_id", discordUserId);
  if (error) {
    logCredentialFailure("delete", error);
    throw new Error("Could not remove saved Roblox credentials.");
  }
}
