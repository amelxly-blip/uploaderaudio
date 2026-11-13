import { getCompensationSpeed, processAudioForPlaybackSpeed } from "./audio-processing.js";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));
const tabs = ["home", "upload", "setup", "history"];
const assetTypes = {
  Audio: {
    title: "Upload audio",
    panel: "File audio",
    subtitle: "MP3, OGG, WAV, atau FLAC · maksimal 20 MB · maksimal 7 menit.",
    formats: "MP3 · OGG · WAV · FLAC",
    accept: ".mp3,.ogg,.wav,.flac,audio/mpeg,audio/ogg,audio/wav,audio/flac",
    icon: "♫",
    name: "Nama audio",
    placeholder: "Contoh: ambience hutan sore",
    rights: "Saya berhak mengunggah audio ini dan memahami Roblox tetap dapat meninjau atau menolaknya.",
  },
  Decal: {
    title: "Upload decal",
    panel: "File gambar",
    subtitle: "PNG, JPG, JPEG, BMP, atau TGA · maksimal 20 MB · maksimal 7999 × 7999 piksel.",
    formats: "PNG · JPG · BMP · TGA",
    accept: ".png,.jpg,.jpeg,.bmp,.tga,image/png,image/jpeg,image/bmp,image/tga",
    icon: "▧",
    name: "Nama decal",
    placeholder: "Contoh: Logo komunitas",
    rights: "Saya memiliki atau berhak mengunggah gambar ini dan memahami Roblox dapat meninjau atau menolaknya.",
  },
  Model: {
    title: "Upload model",
    panel: "File model Roblox",
    subtitle: "File .rbxm atau .rbxmx dari Roblox Studio · maksimal 20 MB.",
    formats: "RBXM · RBXMX",
    accept: ".rbxm,.rbxmx",
    icon: "⬡",
    name: "Nama model",
    placeholder: "Contoh: Model Rumah",
    rights: "Saya berhak mengunggah model ini dan memahami Roblox dapat meninjau atau menolaknya.",
  },
};

let me = {
  authenticated: false,
  robloxConfigured: false,
  apiKeyConfigured: false,
  creatorType: "user",
  creatorId: "",
  creatorLabel: "",
  robloxProfile: null,
};
let selectedFile = null;
let selectedAssetType = "Audio";
let uploadInProgress = false;
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

function setRobloxAvatar(element, profile) {
  element.replaceChildren();
  if (profile?.avatarUrl) {
    try {
      const avatar = new URL(profile.avatarUrl);
      if (avatar.protocol === "https:" && avatar.hostname.endsWith(".rbxcdn.com")) {
        const image = document.createElement("img");
        image.src = avatar.href;
        image.alt = "";
        image.referrerPolicy = "no-referrer";
        image.onerror = () => { element.textContent = initials(profile.displayName || profile.username); };
        element.append(image);
        return;
      }
    } catch {
      // Fall back to the profile initial if Roblox did not return a valid avatar URL.
    }
  }
  element.textContent = profile ? initials(profile.displayName || profile.username) : "?";
}

function creatorDisplayName() {
  if (!me.robloxProfile) return me.creatorLabel;
  return me.creatorType === "group"
    ? `${me.robloxProfile.displayName} · Group ${me.creatorId}`
    : `${me.robloxProfile.displayName} (@${me.robloxProfile.username})`;
}

function updatePlaybackSpeedHelp() {
  const speed = Number($("#playbackSpeed").value);
  $("#speedHelp").textContent =
    `Audio dipercepat ${getCompensationSpeed(speed).toFixed(2)}× sebelum upload. Atur Sound.PlaybackSpeed ke ${speed.toFixed(2)} agar terdengar normal.`;
}

function setAssetType(assetType) {
  if (uploadInProgress || !Object.prototype.hasOwnProperty.call(assetTypes, assetType)) return;
  selectedAssetType = assetType;
  resetFile();
  $("#audioName").value = "";
  const details = assetTypes[assetType];
  $$("[data-asset-type]").forEach((button) => {
    const active = button.dataset.assetType === assetType;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
  $("#uploadTitle").textContent = details.title;
  $("#uploadPanelTitle").textContent = details.panel;
  $("#uploadPanelSubtitle").textContent = details.subtitle;
  $("#dropFormats").textContent = details.formats;
  $("#fileInput").accept = details.accept;
  $("#fileIcon").textContent = details.icon;
  $("#audioSpeedControl").hidden = assetType !== "Audio";
  $("#audioPreview").hidden = true;
  $("#audioNameLabel").textContent = details.name;
  $("#audioName").placeholder = details.placeholder;
  $("#reviewDialogTitle").textContent = `Periksa sebelum upload ${assetType.toLowerCase()}`;
  $("#reviewDialogCopy").textContent =
    `Ini akan membuat asset ${assetType.toLowerCase()} baru di Roblox dan menggunakan kuota creator.`;
  $("#rightsConfirmText").textContent = details.rights;
  $("#uploadAsideSubtitle").textContent =
    `${assetType} baru dibuat di akun atau grup yang diizinkan API key. Kuota aplikasi 5 upload per 24 jam dipakai bersama.`;
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
  $("#homeCloudCreator").textContent = me.robloxConfigured
    ? creatorDisplayName()
    : "Atur API key pribadi di Setup Roblox";
  $("#robloxProfile").hidden = !me.robloxConfigured;
  $("#robloxNotConnected").hidden = me.robloxConfigured;
  $("#setupCreator").textContent = me.creatorType === "group" ? `Grup · ID ${me.creatorId}` : `User ID ${me.creatorId}`;
  $("#robloxDisplayName").textContent = me.robloxProfile?.displayName || "";
  $("#robloxUsername").textContent = me.creatorType === "group"
    ? `Grup · ID ${me.creatorId}`
    : `@${me.robloxProfile?.username || ""} · User ID ${me.creatorId}`;
  setRobloxAvatar($("#robloxAvatar"), me.robloxProfile);
  $("#setupCloudBadge").textContent = me.robloxConfigured ? "TERHUBUNG" : "BELUM AKTIF";
  $("#setupKeyBadge").textContent = me.apiKeyConfigured ? "TERSIMPAN AMAN" : "BELUM AKTIF";
  $("#robloxCreatorType").disabled = !signedIn;
  $("#robloxCreatorId").disabled = !signedIn;
  $("#robloxApiKey").disabled = !signedIn;
  $("#saveRobloxConfig").disabled = !signedIn;
  $("#disconnectRoblox").disabled = !signedIn;
  $("#uploadCloudDot").classList.toggle("ready", !!me.robloxConfigured);
  $("#uploadCloudText").textContent = me.robloxConfigured
    ? `Tujuan: ${creatorDisplayName()}`
    : "Atur Creator ID dan API key di Setup Roblox";
  $("#reviewUpload").disabled = !signedIn || !me.robloxConfigured;
}

async function loadStatus() {
  if (!me.authenticated) {
    me.robloxConfigured = false;
    me.creatorLabel = "";
    me.creatorType = "user";
    me.creatorId = "";
    me.robloxProfile = null;
    $("#robloxCredentialsForm").reset();
    $("#credentialsStatus").className = "status-message";
    $("#credentialsStatus").textContent = "";
    updateIdentity();
    return;
  }
  const data = await callFunction("roblox-status");
  me.robloxConfigured = data.robloxConfigured === true;
  me.apiKeyConfigured = data.apiKeyConfigured === true;
  me.creatorType = data.creatorType === "group" ? "group" : "user";
  me.creatorId = typeof data.creatorId === "string" ? data.creatorId : "";
  me.creatorLabel = typeof data.creatorLabel === "string" ? data.creatorLabel : "";
  me.robloxProfile = data.profile && typeof data.profile === "object"
    ? {
        username: typeof data.profile.username === "string" ? data.profile.username : "",
        displayName: typeof data.profile.displayName === "string" ? data.profile.displayName : "",
        avatarUrl: typeof data.profile.avatarUrl === "string" ? data.profile.avatarUrl : "",
      }
    : null;
  $("#robloxCreatorType").value = me.creatorType;
  $("#robloxCreatorId").value = me.creatorId;
  updateIdentity();
}

function showCredentialsStatus(type, message) {
  const status = $("#credentialsStatus");
  status.className = `status-message visible ${type}`;
  status.textContent = message;
}

async function saveRobloxCredentials(event) {
  event.preventDefault();
  const creatorType = $("#robloxCreatorType").value;
  const creatorId = $("#robloxCreatorId").value.trim();
  const apiKey = $("#robloxApiKey").value;
  if (!me.authenticated) {
    showCredentialsStatus("error", "Masuk dengan Discord sebelum menyimpan konfigurasi.");
    return;
  }
  if (!/^[1-9][0-9]{0,15}$/.test(creatorId) || !Number.isSafeInteger(Number(creatorId))) {
    showCredentialsStatus("error", "Masukkan Creator ID Roblox berupa angka yang valid.");
    return;
  }
  if (!me.apiKeyConfigured && !apiKey.trim()) {
    showCredentialsStatus("error", "Masukkan API key Open Cloud untuk konfigurasi pertama.");
    $("#robloxApiKey").focus();
    return;
  }

  const button = $("#saveRobloxConfig");
  button.disabled = true;
  button.textContent = "Menyimpan...";
  try {
    const data = await callFunction("roblox-configure", {
      body: { creatorType, creatorId, apiKey },
    });
    me.robloxConfigured = data.robloxConfigured === true;
    me.apiKeyConfigured = data.apiKeyConfigured === true;
    me.creatorType = data.creatorType === "group" ? "group" : "user";
    me.creatorId = typeof data.creatorId === "string" ? data.creatorId : creatorId;
    me.creatorLabel = typeof data.creatorLabel === "string" ? data.creatorLabel : "";
    me.robloxProfile = data.profile && typeof data.profile === "object"
      ? {
          username: typeof data.profile.username === "string" ? data.profile.username : "",
          displayName: typeof data.profile.displayName === "string" ? data.profile.displayName : "",
          avatarUrl: typeof data.profile.avatarUrl === "string" ? data.profile.avatarUrl : "",
        }
      : null;
    $("#robloxApiKey").value = "";
    $("#robloxCreatorType").value = me.creatorType;
    $("#robloxCreatorId").value = me.creatorId;
    updateIdentity();
    showCredentialsStatus("success", "Konfigurasi Roblox tersimpan untuk akun Discord ini.");
  } catch (error) {
    showCredentialsStatus("error", error.message || "Konfigurasi tidak bisa disimpan. Coba lagi.");
  } finally {
    button.textContent = "Simpan konfigurasi";
    button.disabled = !me.authenticated;
  }
}

async function disconnectRoblox() {
  if (!me.robloxConfigured || !me.authenticated) return;
  if (!window.confirm("Putuskan akun Roblox ini dari Discord kamu?")) return;
  const button = $("#disconnectRoblox");
  button.disabled = true;
  button.textContent = "Memutuskan...";
  try {
    await callFunction("roblox-disconnect");
    me.robloxConfigured = false;
    me.apiKeyConfigured = false;
    me.creatorType = "user";
    me.creatorId = "";
    me.creatorLabel = "";
    me.robloxProfile = null;
    $("#robloxCredentialsForm").reset();
    $("#credentialsStatus").className = "status-message";
    $("#credentialsStatus").textContent = "";
    updateIdentity();
    showToast("Akun Roblox sudah diputuskan.");
  } catch (error) {
    showCredentialsStatus("error", error.message || "Akun Roblox tidak bisa diputuskan. Coba lagi.");
  } finally {
    button.textContent = "Keluar akun";
    button.disabled = !me.authenticated;
  }
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
    me.creatorType = "user";
    me.creatorId = "";
    me.creatorLabel = "";
    me.robloxProfile = null;
    $("#robloxCredentialsForm").reset();
    $("#credentialsStatus").className = "status-message";
    $("#credentialsStatus").textContent = "";
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
    me.creatorType = "user";
    me.creatorId = "";
    me.creatorLabel = "";
    $("#robloxCredentialsForm").reset();
    $("#credentialsStatus").className = "status-message";
    $("#credentialsStatus").textContent = "";
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
    robloxConfigured: false,
    apiKeyConfigured: false,
    creatorType: "user",
    creatorId: "",
    creatorLabel: "",
    robloxProfile: null,
  };
  $("#robloxCredentialsForm").reset();
  $("#credentialsStatus").className = "status-message";
  $("#credentialsStatus").textContent = "";
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

function setUploadBusy(isBusy) {
  uploadInProgress = isBusy;
  document.body.classList.toggle("upload-busy", isBusy);
  $("#fileInput").disabled = isBusy;
  $("#removeFile").disabled = isBusy;
  $("#audioName").disabled = isBusy;
  $("#playbackSpeed").disabled = isBusy;
  $$("[data-asset-type]").forEach((button) => { button.disabled = isBusy; });
  $("#reviewUpload").disabled = isBusy || !me.authenticated || !me.robloxConfigured;
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
  if (!file || uploadInProgress) return;
  resetFile();
  const extension = file.name.split(".").pop().toLowerCase();
  const validExtensions = {
    Audio: ["mp3", "ogg", "wav", "flac"],
    Decal: ["png", "jpg", "jpeg", "bmp", "tga"],
    Model: ["rbxm", "rbxmx"],
  }[selectedAssetType];
  if (!validExtensions.includes(extension)) {
    showUploadStatus("error", `Format file tidak sesuai. Pilih: ${assetTypes[selectedAssetType].formats}.`);
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
  if (selectedAssetType === "Audio") {
    previewUrl = URL.createObjectURL(file);
    $("#audioPreview").src = previewUrl;
    $("#audioPreview").hidden = false;
  }
  clearUploadStatus();
}

function openReview() {
  if (!me.authenticated) { showToast("Masuk dengan Discord dulu."); return; }
  if (!me.robloxConfigured) {
    showUploadStatus("error", "Konfigurasi Roblox belum lengkap. Atur Creator ID dan API key di Setup Roblox.");
    return;
  }
  const name = $("#audioName").value.trim();
  if (!selectedFile) { showUploadStatus("error", "Pilih file lebih dulu."); return; }
  if (!name || name.length > 50) {
    showUploadStatus("error", "Nama asset wajib diisi (maksimal 50 karakter).");
    $("#audioName").focus();
    return;
  }
  $("#reviewFile").textContent = `${selectedFile.name} · ${formatSize(selectedFile.size)}`;
  $("#reviewName").textContent = name;
  $("#reviewCreator").textContent = creatorDisplayName() || "Creator Roblox yang terhubung";
  $("#reviewPlaybackSpeedRow").hidden = selectedAssetType !== "Audio";
  if (selectedAssetType === "Audio") {
    $("#reviewPlaybackSpeed").textContent =
      `${Number($("#playbackSpeed").value).toFixed(2)}× di Roblox · audio dipercepat ${getCompensationSpeed($("#playbackSpeed").value).toFixed(2)}× saat diproses`;
  }
  $("#rightsConfirm").checked = false;
  $("#confirmUpload").disabled = true;
  $("#confirmDialog").showModal();
}

async function pollOperation(uploadId, assetType) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 2500));
    const data = await callFunction("roblox-operation", { body: { uploadId } });
    if (data.status === "completed") {
      showUploadStatus("success", `Upload ${assetType.toLowerCase()} selesai. Asset ID: ${data.assetId}`);
      await loadHistory();
      return;
    }
    if (data.status === "failed") throw new Error(data.error || "Roblox menolak upload.");
  }
  showUploadStatus("pending", `Roblox masih memproses ${assetType.toLowerCase()}. Cek riwayat sebentar lagi.`);
  await loadHistory();
}

async function submitUpload() {
  $("#confirmDialog").close();
  if (!selectedFile) return;
  const file = selectedFile;
  const name = $("#audioName").value.trim();
  setUploadBusy(true);
  $("#uploadProgress").hidden = false;
  const assetType = selectedAssetType;
  const playbackSpeed = Number($("#playbackSpeed").value);
  showUploadStatus("pending", assetType === "Audio" && playbackSpeed !== 1
    ? "Memproses speed audio di browser…"
    : `Mengirim ${assetType.toLowerCase()} ke Roblox Open Cloud…`);
  try {
    const uploadFile = assetType === "Audio"
      ? await processAudioForPlaybackSpeed(file, playbackSpeed)
      : file;
    const data = await callFunction("roblox-upload", {
      body: uploadFile,
      headers: {
        "x-audio-name": encodeURIComponent(name),
        "x-audio-filename": encodeURIComponent(uploadFile.name),
        "x-asset-type": assetType,
      },
    });
    if (data.status !== "processing" || typeof data.uploadId !== "string") {
      throw new Error("Layanan uploader tidak mengembalikan status upload yang valid.");
    }
    await loadHistory();
    showUploadStatus("pending", `Roblox sedang memproses ${assetType.toLowerCase()}…`);
    await pollOperation(data.uploadId, assetType);
    resetFile(true);
    $("#audioName").value = "";
  } catch (error) {
    showUploadStatus("error", error.message);
    await loadHistory();
  } finally {
    $("#uploadProgress").hidden = true;
    setUploadBusy(false);
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
    const type = ["Audio", "Decal", "Model"].includes(item.asset_type) ? item.asset_type : "Audio";
    return `<tr><td class="name-cell">${escapeHtml(item.display_name)}</td><td>${type}</td><td>${escapeHtml(formatSize(size))}</td><td>${escapeHtml(date)}</td><td>${idCell}</td><td><span class="history-badge ${statusClass}">${label}</span></td></tr>`;
  }).join("");
  target.innerHTML = `<div class="table-wrap"><table class="history-table"><thead><tr><th>Nama asset</th><th>Jenis</th><th>Ukuran</th><th>Waktu</th><th>Asset ID</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function renderRecent() {
  const target = $("#recentActivity");
  const latest = history.slice(0, 2);
  if (!latest.length) {
    target.innerHTML = '<div class="recent-empty"><span>♫</span>Belum ada asset di workspace</div>';
    return;
  }
  target.innerHTML = latest.map((item) => {
    const status = item.status === "completed" ? "Selesai" : item.status === "processing" ? "Diproses" : "Gagal";
    const date = item.created_at ? new Date(item.created_at).toLocaleString("id-ID") : "";
    const type = ["Audio", "Decal", "Model"].includes(item.asset_type) ? item.asset_type : "Audio";
    const icon = type === "Audio" ? "♫" : type === "Decal" ? "▧" : "⬡";
    return `<div class="recent-row"><div class="track-icon">${icon}</div><div class="track-copy"><div class="track-name">${escapeHtml(item.display_name)}</div><div class="track-meta">${type} · ${escapeHtml(date)}${item.asset_id ? ` · ${escapeHtml(item.asset_id)}` : ""}</div></div><span class="tag">${status}</span></div>`;
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
$$("[data-asset-type]").forEach((button) => button.addEventListener("click", () => setAssetType(button.dataset.assetType)));
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
$("#robloxCredentialsForm").addEventListener("submit", saveRobloxCredentials);
$("#disconnectRoblox").addEventListener("click", disconnectRoblox);
$("#playbackSpeed").addEventListener("change", updatePlaybackSpeedHelp);
$("#cancelReview").addEventListener("click", () => $("#confirmDialog").close());
$("#rightsConfirm").addEventListener("change", (event) => { $("#confirmUpload").disabled = !event.target.checked; });
$("#confirmUpload").addEventListener("click", submitUpload);
buildWaveform();
updatePlaybackSpeedHelp();
setAssetType("Audio");
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
