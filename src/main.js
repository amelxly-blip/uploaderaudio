const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));
const tabs = ["home", "upload", "setup", "history"];

let me = {
  authenticated: false,
  robloxConfigured: false,
  apiKeyConfigured: false,
  creatorLabel: "",
};
let selectedFile = null;
let previewUrl = null;
let toastTimer;
let history = [];

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 3000);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char]);
}

function initials(name) {
  return (name || "?").trim().charAt(0).toUpperCase() || "?";
}

function discordUser(user) {
  if (!user || typeof user.id !== "string") return null;
  const username = typeof user.username === "string" ? user.username : "Discord user";
  return {
    id: user.id,
    username,
    displayName: typeof user.displayName === "string" ? user.displayName : username,
    avatarUrl: typeof user.avatarUrl === "string" ? user.avatarUrl : "",
  };
}

function setAvatar(element, user) {
  element.replaceChildren();
  if (user?.avatarUrl) {
    try {
      const avatar = new URL(user.avatarUrl);
      if (avatar.protocol === "https:" && avatar.hostname === "cdn.discordapp.com") {
        const image = document.createElement("img");
        image.src = avatar.href;
        image.alt = "";
        image.referrerPolicy = "no-referrer";
        image.onerror = () => { element.textContent = initials(user.displayName || user.username); };
        element.append(image);
        return;
      }
    } catch {
      // Fall back to the profile initial if Discord did not return a valid avatar URL.
    }
  }
  element.textContent = user ? initials(user.displayName || user.username) : "?";
}

function navigate(tab) {
  if (!tabs.includes(tab)) return;
  if (tab !== "home" && !me.authenticated) {
    showToast("Masuk dengan Discord dulu untuk membuka bagian ini.");
    return;
  }
  $$(".page").forEach((page) => page.classList.toggle("active", page.id === `page-${tab}`));
  $$("[data-tab]").forEach((button) => button.classList.toggle("active", button.dataset.tab === tab));
  $("#topbarLabel").textContent = `AUDIO WORKSPACE / ${({ home: "BERANDA", upload: "UPLOAD", setup: "SETUP ROBLOX", history: "RIWAYAT" })[tab]}`;
  if (tab === "history") void loadHistory();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function updateIdentity() {
  const user = me.discordUser;
  const signedIn = !!user && me.authenticated;
  $("#railName").textContent = user ? user.displayName || user.username : "Belum terhubung";
  $("#railHint").textContent = signedIn ? `Discord · ${user.username}` : "Masuk untuk mulai";
  setAvatar($("#railAvatar"), user);
  setAvatar($("#topbarAvatar"), user);
  $("#topbarAvatar").hidden = !user;
  $("#authButton").textContent = user ? "Keluar" : "Masuk dengan Discord";
  $("#heroEyebrow").textContent = signedIn ? "WORKSPACE AKTIF" : "RUANG AUDIO KAMU";
  $("#heroIdentity").hidden = !user;
  if (user) {
    setAvatar($("#heroAvatar"), user);
    $("#heroDisplayName").textContent = user.displayName || user.username;
    $("#heroUsername").textContent = `@${user.username}`;
  }
  $("#heroTitle").innerHTML = signedIn
    ? `Halo, ${escapeHtml(user.displayName || user.username)}.<br>Mulai dari audio.`
    : "Audio siap.<br>Ruangnya juga.";
  $("#heroText").textContent = signedIn
    ? "Pilih file dan kirim lewat Roblox Open Cloud. Setiap akun Discord mendapat 5 upload per 24 jam."
    : "Unggah audio milikmu ke Roblox lewat Open Cloud. Masuk dengan Discord untuk menghubungkan workspace.";
  $("#heroAction").innerHTML = signedIn
    ? "Mulai upload <span>↗</span>"
    : "Masuk dengan Discord <span>↗</span>";
  $("#heroAction").onclick = () => signedIn ? navigate("upload") : login();
  $("#signedOutNotice").hidden = signedIn;
  $("#signedOutNotice").textContent =
    "Masuk dengan Discord untuk membuka upload, setup, dan riwayat. Setiap akun mendapat 5 upload per 24 jam.";
  $$("[data-lock]").forEach((lock) => { lock.hidden = signedIn; });
  $("#railCloudDot").classList.toggle("ready", !!me.robloxConfigured);
  $("#railCloudText").textContent = me.robloxConfigured ? "Open Cloud terhubung" : "Open Cloud belum diatur";
  $("#homeCloudStatus").textContent = me.robloxConfigured ? "Open Cloud siap" : "Belum dikonfigurasi";
  $("#homeCloudCreator").textContent = me.creatorLabel || "API key disimpan di Edge Function";
  $("#setupCreator").textContent = me.creatorLabel || "Belum diatur";
  $("#setupCloudBadge").textContent = me.robloxConfigured ? "TERHUBUNG" : "BELUM AKTIF";
  $("#setupKeyBadge").textContent = me.apiKeyConfigured ? "TERSIMPAN AMAN" : "BELUM AKTIF";
  $("#uploadCloudDot").classList.toggle("ready", !!me.robloxConfigured);
  $("#uploadCloudText").textContent = me.robloxConfigured ? `Tujuan: ${me.creatorLabel}` : "Open Cloud belum dikonfigurasi di Edge Function";
  $("#reviewUpload").disabled = !signedIn || !me.robloxConfigured;
}

async function loadStatus() {
  if (!me.authenticated) {
    me.robloxConfigured = false;
    me.creatorLabel = "";
    updateIdentity();
    return;
  }
  const data = await callFunction("roblox-status");
  me.robloxConfigured = data.robloxConfigured === true;
  me.apiKeyConfigured = data.apiKeyConfigured === true;
  me.creatorLabel = typeof data.creatorLabel === "string" ? data.creatorLabel : "";
  updateIdentity();
}

async function loadHistory() {
  if (!me.authenticated) {
    history = [];
    renderHistory();
    renderRecent();
    return;
  }
  try {
    const data = await callFunction("roblox-history");
    history = Array.isArray(data.uploads) ? data.uploads : [];
    renderHistory();
    renderRecent();
  } catch {
    showToast("Riwayat gagal dimuat.");
  }
}

async function callFunction(name, { body = {}, headers = {} } = {}) {
  const requestHeaders = new Headers(headers);
  let requestBody;
  if (body instanceof Blob) {
    requestBody = body;
  } else {
    requestHeaders.set("Content-Type", "application/json");
    requestBody = JSON.stringify(body);
  }

  const response = await fetch(`/api/functions/${encodeURIComponent(name)}`, {
    method: "POST",
    headers: requestHeaders,
    body: requestBody,
    cache: "no-store",
    credentials: "same-origin",
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(typeof data?.error === "string" ? data.error : "Permintaan ke layanan uploader gagal.");
  }
  if (!data || typeof data !== "object") {
    throw new Error("Layanan uploader mengembalikan respons yang tidak valid.");
  }
  return data;
}

async function refreshSession(showErrors = false) {
  let data;
  try {
    const response = await fetch("/api/auth/session", {
      cache: "no-store",
      credentials: "same-origin",
    });
    data = await response.json().catch(() => null);
    if (!response.ok || !data || typeof data !== "object") {
      throw new Error(typeof data?.error === "string" ? data.error : "Status login gagal dimuat.");
    }
  } catch (error) {
    me.authenticated = false;
    me.discordUser = null;
    me.robloxConfigured = false;
    me.apiKeyConfigured = false;
    me.creatorLabel = "";
    updateIdentity();
    history = [];
    renderHistory();
    renderRecent();
    if (showErrors) showToast(error.message);
    return;
  }

  me.authenticated = !!data.user;
  me.discordUser = discordUser(data.user);
  if (!me.authenticated) {
    me.robloxConfigured = false;
    me.apiKeyConfigured = false;
    me.creatorLabel = "";
    history = [];
    renderHistory();
    renderRecent();
    updateIdentity();
    return;
  }

  updateIdentity();
  try {
    await loadStatus();
    await loadHistory();
  } catch (error) {
    history = [];
    renderHistory();
    renderRecent();
    updateIdentity();
    if (showErrors) showToast(error.message);
  }
}

async function loadSession() {
  const url = new URL(window.location.href);
  const authError = url.searchParams.get("discord_error");
  if (authError) {
    url.searchParams.delete("discord_error");
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  }

  await refreshSession(true);
  if (authError) {
    showToast(authError === "denied"
      ? "Login Discord dibatalkan."
      : "Login Discord gagal. Periksa konfigurasi Cloudflare dan coba lagi.");
  }
}

async function login() {
  window.location.assign("/api/auth/discord");
}

async function logout() {
  try {
    const response = await fetch("/api/auth/logout", {
      method: "POST",
      cache: "no-store",
      credentials: "same-origin",
    });
    if (!response.ok) throw new Error("Tidak bisa keluar dari Discord. Coba lagi.");
  } catch (error) {
    showToast(error.message || "Tidak bisa keluar dari Discord. Coba lagi.");
    return;
  }

  me = {
    authenticated: false,
    robloxConfigured: me.robloxConfigured,
    apiKeyConfigured: me.apiKeyConfigured,
    creatorLabel: me.creatorLabel,
  };
  history = [];
  renderHistory();
  renderRecent();
  updateIdentity();
  navigate("home");
  showToast("Kamu sudah keluar.");
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(2)} MB`;
}

function showUploadStatus(type, text) {
  const status = $("#uploadStatus");
  status.className = `status-message visible ${type}`;
  status.textContent = text;
}

function clearUploadStatus() {
  $("#uploadStatus").className = "status-message";
  $("#uploadStatus").textContent = "";
  $("#uploadProgress").hidden = true;
}

function resetFile(preserveStatus = false) {
  selectedFile = null;
  $("#fileInput").value = "";
  $("#fileCard").classList.remove("visible");
  $("#audioPreview").hidden = true;
  $("#audioPreview").removeAttribute("src");
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = null;
  if (!preserveStatus) clearUploadStatus();
}

function handleFile(file) {
  if (!file) return;
  const extension = file.name.split(".").pop().toLowerCase();
  if (!["mp3", "ogg", "wav", "flac"].includes(extension)) {
    showUploadStatus("error", "Format ini belum didukung. Pilih MP3, OGG, WAV, atau FLAC.");
    return;
  }
  if (file.size > 20 * 1024 * 1024) {
    showUploadStatus("error", "Ukuran file lebih dari 20 MB. Pilih file yang lebih kecil.");
    return;
  }
  selectedFile = file;
  $("#fileName").textContent = file.name;
  $("#fileMeta").textContent = `${formatSize(file.size)} · ${extension.toUpperCase()}`;
  $("#fileCard").classList.add("visible");
  $("#audioName").value = $("#audioName").value.trim() || file.name.replace(/\.[^.]+$/, "").slice(0, 50);
  previewUrl = URL.createObjectURL(file);
  $("#audioPreview").src = previewUrl;
  $("#audioPreview").hidden = false;
  clearUploadStatus();
}

function openReview() {
  if (!me.authenticated) { showToast("Masuk dengan Discord dulu."); return; }
  if (!me.robloxConfigured) {
    showUploadStatus("error", "Open Cloud belum diatur. Periksa secret Edge Function di Supabase.");
    return;
  }
  const name = $("#audioName").value.trim();
  if (!selectedFile) { showUploadStatus("error", "Pilih file audio lebih dulu."); return; }
  if (!name || name.length > 50) {
    showUploadStatus("error", "Nama asset wajib diisi (maksimal 50 karakter).");
    $("#audioName").focus();
    return;
  }
  $("#reviewFile").textContent = `${selectedFile.name} · ${formatSize(selectedFile.size)}`;
  $("#reviewName").textContent = name;
  $("#reviewCreator").textContent = me.creatorLabel || "Creator Roblox yang dikonfigurasi di Supabase";
  $("#rightsConfirm").checked = false;
  $("#confirmUpload").disabled = true;
  $("#confirmDialog").showModal();
}

async function pollOperation(uploadId) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 2500));
    const data = await callFunction("roblox-operation", { body: { uploadId } });
    if (data.status === "completed") {
      showUploadStatus("success", `Upload selesai. Asset ID: ${data.assetId}`);
      await loadHistory();
      return;
    }
    if (data.status === "failed") throw new Error(data.error || "Roblox menolak upload.");
  }
  showUploadStatus("pending", "Roblox masih memproses audio. Cek riwayat sebentar lagi.");
  await loadHistory();
}

async function submitUpload() {
  $("#confirmDialog").close();
  if (!selectedFile) return;
  const file = selectedFile;
  const name = $("#audioName").value.trim();
  $("#reviewUpload").disabled = true;
  $("#uploadProgress").hidden = false;
  showUploadStatus("pending", "Mengirim audio ke Roblox Open Cloud…");
  try {
    const data = await callFunction("roblox-upload", {
      body: file,
      headers: {
        "x-audio-name": encodeURIComponent(name),
        "x-audio-filename": encodeURIComponent(file.name),
      },
    });
    if (data.status !== "processing" || typeof data.uploadId !== "string") {
      throw new Error("Layanan uploader tidak mengembalikan status upload yang valid.");
    }
    await loadHistory();
    showUploadStatus("pending", "Roblox sedang memproses audio…");
    await pollOperation(data.uploadId);
    resetFile(true);
  } catch (error) {
    showUploadStatus("error", error.message);
    await loadHistory();
  } finally {
    $("#uploadProgress").hidden = true;
    $("#reviewUpload").disabled = !me.authenticated || !me.robloxConfigured;
  }
}

function renderHistory() {
  const target = $("#historyContainer");
  $("#historyCount").textContent = `${history.length} asset`;
  if (!history.length) {
    target.innerHTML = '<div class="history-empty"><div class="track-icon">♫</div><p>Belum ada upload. Asset ID akan muncul setelah Roblox menyelesaikan operasi.</p></div>';
    return;
  }
  const rows = history.map((item) => {
    const label = item.status === "completed" ? "Selesai" : item.status === "processing" ? "Diproses" : "Gagal";
    const statusClass = item.status === "completed" ? "success" : item.status === "processing" ? "pending" : "error";
    const size = Number(item.file_size) || 0;
    const date = item.created_at ? new Date(item.created_at).toLocaleString("id-ID") : "—";
    const idCell = item.asset_id ? `<span class="tag">${escapeHtml(item.asset_id)}</span>` : "—";
    return `<tr><td class="name-cell">${escapeHtml(item.display_name)}</td><td>${escapeHtml(formatSize(size))}</td><td>${escapeHtml(date)}</td><td>${idCell}</td><td><span class="history-badge ${statusClass}">${label}</span></td></tr>`;
  }).join("");
  target.innerHTML = `<div class="table-wrap"><table class="history-table"><thead><tr><th>Nama asset</th><th>Ukuran</th><th>Waktu</th><th>Asset ID</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function renderRecent() {
  const target = $("#recentActivity");
  const latest = history.slice(0, 2);
  if (!latest.length) {
    target.innerHTML = '<div class="recent-empty"><span>♫</span>Belum ada audio di workspace</div>';
    return;
  }
  target.innerHTML = latest.map((item) => {
    const status = item.status === "completed" ? "Selesai" : item.status === "processing" ? "Diproses" : "Gagal";
    const date = item.created_at ? new Date(item.created_at).toLocaleString("id-ID") : "";
    return `<div class="recent-row"><div class="track-icon">♫</div><div class="track-copy"><div class="track-name">${escapeHtml(item.display_name)}</div><div class="track-meta">${escapeHtml(date)}${item.asset_id ? ` · ${escapeHtml(item.asset_id)}` : ""}</div></div><span class="tag">${status}</span></div>`;
  }).join("");
}

function buildWaveform() {
  const art = $("#heroArt");
  let seed = 41;
  const next = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  art.innerHTML = Array.from({ length: 28 }, () => `<span style="height:${20 + Math.round(next() * 76)}%"></span>`).join("");
}

$$("[data-tab]").forEach((button) => button.addEventListener("click", () => navigate(button.dataset.tab)));
$$("[data-go]").forEach((button) => button.addEventListener("click", () => navigate(button.dataset.go)));
$("#authButton").addEventListener("click", () => me.authenticated ? logout() : login());
$("#fileInput").addEventListener("change", (event) => handleFile(event.target.files[0]));
$("#removeFile").addEventListener("click", resetFile);
$("#dropzone").addEventListener("dragover", (event) => { event.preventDefault(); $("#dropzone").classList.add("dragging"); });
$("#dropzone").addEventListener("dragleave", () => $("#dropzone").classList.remove("dragging"));
$("#dropzone").addEventListener("drop", (event) => {
  event.preventDefault();
  $("#dropzone").classList.remove("dragging");
  handleFile(event.dataTransfer.files[0]);
});
$("#reviewUpload").addEventListener("click", openReview);
$("#cancelReview").addEventListener("click", () => $("#confirmDialog").close());
$("#rightsConfirm").addEventListener("change", (event) => { $("#confirmUpload").disabled = !event.target.checked; });
$("#confirmUpload").addEventListener("click", submitUpload);
buildWaveform();
updateIdentity();
void loadSession();
setTimeout(() => {
  const boot = $("#boot");
  boot.classList.add("done");
  setTimeout(() => {
    boot.hidden = true;
    boot.setAttribute("aria-hidden", "true");
  }, 600);
}, 550);
