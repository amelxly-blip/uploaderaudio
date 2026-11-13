const $ = (selector) => document.querySelector(selector);
let overview = null;
let refreshTimer;

function setMessage(element, message, isError = true) {
  element.textContent = message;
  element.style.color = isError ? "#e7aaaa" : "#b7d9c2";
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    cache: "no-store",
    credentials: "same-origin",
    ...options,
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(typeof data?.error === "string" ? data.error : "Permintaan admin gagal.");
    error.status = response.status;
    throw error;
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Respons admin tidak valid. Pastikan Pages Functions sudah aktif.");
  }
  return data;
}

async function adminAction(action) {
  return requestJson("/api/admin/functions/site-admin", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(action),
  });
}

function showLogin() {
  $("#loginPanel").hidden = false;
  $("#adminPanel").hidden = true;
  $("#logoutButton").hidden = true;
  clearInterval(refreshTimer);
}

function showAdmin() {
  $("#loginPanel").hidden = true;
  $("#adminPanel").hidden = false;
  $("#logoutButton").hidden = false;
}

function makeAvatar(profile) {
  const avatar = document.createElement("div");
  avatar.className = "avatar";
  const fallback = profile?.display_name || profile?.username || "?";
  avatar.textContent = fallback.trim().charAt(0).toUpperCase() || "?";
  if (typeof profile?.avatar_url === "string" && profile.avatar_url) {
    try {
      const url = new URL(profile.avatar_url);
      if (url.protocol === "https:" && url.hostname === "cdn.discordapp.com") {
        const image = document.createElement("img");
        image.src = url.href;
        image.alt = "";
        image.referrerPolicy = "no-referrer";
        image.onerror = () => {
          image.remove();
          avatar.textContent = fallback.trim().charAt(0).toUpperCase() || "?";
        };
        avatar.replaceChildren(image);
      }
    } catch {
      // The initials remain visible when Discord's avatar URL is invalid.
    }
  }
  return avatar;
}

function createPerson(record, kind) {
  const row = document.createElement("article");
  row.className = "person";
  row.append(makeAvatar(record));

  const copy = document.createElement("div");
  copy.className = "person-copy";
  const name = document.createElement("div");
  name.className = "person-name";
  name.textContent = record.display_name || record.username || record.discord_user_id;
  const meta = document.createElement("div");
  meta.className = "person-meta";
  const details = [`@${record.username || "belum login"}`, `ID ${record.discord_user_id}`];
  if (kind === "vip") details.push(`Berakhir ${formatCountdown(record.expires_at)}`);
  if (kind === "online") details.push(`Aktif ${formatTime(record.last_seen_at)}`);
  if (kind === "ban" && record.reason) details.push(record.reason);
  meta.textContent = details.join(" · ");
  if (kind === "vip") {
    meta.dataset.expiry = record.expires_at;
    meta.dataset.username = record.username || "belum login";
    meta.dataset.discordId = record.discord_user_id;
  }
  copy.append(name, meta);
  row.append(copy);

  const actions = document.createElement("div");
  actions.className = "person-actions";
  if (kind === "online") {
    actions.append(
      makeAction("Ban", "ban", record.discord_user_id, true),
      makeAction("VIP", "prefill-vip", record.discord_user_id),
    );
  } else if (kind === "vip") {
    actions.append(makeAction("Cabut", "revoke-vip", record.discord_user_id, true));
  } else {
    actions.append(makeAction("Buka blokir", "unban", record.discord_user_id));
  }
  row.append(actions);
  return row;
}

function makeAction(label, action, id, danger = false) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = danger ? "mini danger" : "mini";
  button.dataset.action = action;
  button.dataset.id = id;
  button.textContent = label;
  return button;
}

function renderList(container, count, records, kind) {
  $(count).textContent = String(records.length);
  container.replaceChildren();
  if (!records.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "Belum ada data.";
    container.append(empty);
    return;
  }
  for (const record of records) container.append(createPerson(record, kind));
}

function formatTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleTimeString("id-ID");
}

function formatCountdown(value) {
  const remaining = new Date(value).getTime() - Date.now();
  if (!Number.isFinite(remaining) || remaining <= 0) return "habis";
  const days = Math.floor(remaining / 86_400_000);
  const hours = Math.floor((remaining % 86_400_000) / 3_600_000);
  const minutes = Math.floor((remaining % 3_600_000) / 60_000);
  const seconds = Math.floor((remaining % 60_000) / 1000);
  return `${days} hari ${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function renderOverview() {
  if (!overview) return;
  $("#totalVisitors").textContent = Number(overview.totalVisitors || 0).toLocaleString("id-ID");
  $("#totalVip").textContent = Number(overview.totalVip || 0).toLocaleString("id-ID");
  $("#totalUploads").textContent = Number(overview.totalUploads || 0).toLocaleString("id-ID");
  renderList($("#onlineList"), "#onlineCount", overview.onlineUsers || [], "online");
  renderList($("#vipList"), "#vipCount", overview.vipMembers || [], "vip");
  renderList($("#banList"), "#banCount", overview.bannedUsers || [], "ban");
}

function updateVipCountdowns() {
  document.querySelectorAll(".person-meta[data-expiry]").forEach((meta) => {
    meta.textContent = `@${meta.dataset.username} · ID ${meta.dataset.discordId} · Berakhir ${formatCountdown(meta.dataset.expiry)}`;
  });
}

async function loadOverview() {
  try {
    overview = await adminAction({ action: "overview" });
    if (
      !Array.isArray(overview.onlineUsers)
      || !Array.isArray(overview.vipMembers)
      || !Array.isArray(overview.bannedUsers)
      || !Number.isFinite(Number(overview.totalVisitors))
      || !Number.isFinite(Number(overview.totalVip))
      || !Number.isFinite(Number(overview.totalUploads))
    ) {
      throw new Error("Ringkasan admin dari server tidak valid.");
    }
    renderOverview();
  } catch (error) {
    if (error.status === 401) {
      showLogin();
      setMessage($("#loginMessage"), "Sesi admin habis. Masuk lagi.");
      return;
    }
    setMessage($("#vipMessage"), `Data gagal dimuat: ${error.message}`);
  }
}

async function verifySession() {
  try {
    const session = await requestJson("/api/admin/session");
    if (!session.configured) {
      setMessage($("#loginMessage"), "Atur secret ADMIN_PANEL_PASSWORD di Cloudflare Pages sebelum login.");
      return;
    }
    if (!session.authenticated) return;
    showAdmin();
    await loadOverview();
    refreshTimer = setInterval(() => void loadOverview(), 10_000);
  } catch (error) {
    setMessage($("#loginMessage"), error.message);
  }
}

$("#loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = $("#loginForm button[type=submit]");
  button.disabled = true;
  setMessage($("#loginMessage"), "");
  try {
    await requestJson("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: $("#adminPassword").value }),
    });
    $("#adminPassword").value = "";
    showAdmin();
    await loadOverview();
    refreshTimer = setInterval(() => void loadOverview(), 10_000);
  } catch (error) {
    setMessage($("#loginMessage"), error.message);
  } finally {
    button.disabled = false;
  }
});

$("#vipForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const discordUserId = $("#vipDiscordId").value.trim();
  if (!/^[0-9]{17,20}$/.test(discordUserId)) {
    setMessage($("#vipMessage"), "Masukkan Discord ID numerik yang valid.");
    return;
  }
  try {
    const result = await adminAction({
      action: "grant_vip",
      discordUserId,
      durationDays: Number($("#vipDuration").value),
    });
    $("#vipForm").reset();
    setMessage($("#vipMessage"), `Premium aktif sampai ${new Date(result.expiresAt).toLocaleString("id-ID")}.`, false);
    await loadOverview();
  } catch (error) {
    setMessage($("#vipMessage"), error.message);
  }
});

$("#banForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const discordUserId = $("#banDiscordId").value.trim();
  if (!/^[0-9]{17,20}$/.test(discordUserId)) {
    setMessage($("#banMessage"), "Masukkan Discord ID numerik yang valid.");
    return;
  }
  if (!window.confirm(`Blokir akun Discord ${discordUserId}?`)) return;
  try {
    await adminAction({
      action: "ban_user",
      discordUserId,
      reason: $("#banReason").value.trim(),
    });
    $("#banForm").reset();
    setMessage($("#banMessage"), "Akun berhasil diblokir.", false);
    await loadOverview();
  } catch (error) {
    setMessage($("#banMessage"), error.message);
  }
});

document.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const { action, id } = button.dataset;
  if (action === "prefill-vip") {
    $("#vipDiscordId").value = id;
    $("#vipDiscordId").focus();
    window.scrollTo({ top: 0, behavior: "smooth" });
    return;
  }
  if (action === "ban") {
    if (!window.confirm(`Blokir akun Discord ${id}?`)) return;
    $("#banDiscordId").value = id;
    $("#banReason").value = "Aturan komunitas";
    await $("#banForm").requestSubmit();
    return;
  }
  if (action === "revoke-vip" && !window.confirm(`Cabut Premium dari ${id}?`)) return;
  if (action === "unban" && !window.confirm(`Buka blokir akun ${id}?`)) return;
  try {
    if (action === "revoke-vip") await adminAction({ action: "revoke_vip", discordUserId: id });
    else if (action === "unban") await adminAction({ action: "unban_user", discordUserId: id });
    await loadOverview();
  } catch (error) {
    setMessage($("#vipMessage"), error.message);
  }
});

$("#logoutButton").addEventListener("click", async () => {
  try {
    await requestJson("/api/admin/logout", { method: "POST" });
    overview = null;
    showLogin();
    setMessage($("#loginMessage"), "Kamu sudah keluar dari admin panel.", false);
  } catch (error) {
    setMessage($("#vipMessage"), error.message);
  }
});

setInterval(updateVipCountdowns, 1000);
void verifySession();
