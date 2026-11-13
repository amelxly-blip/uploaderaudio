import { createClient } from "@supabase/supabase-js";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));
const tabs = ["home", "upload", "setup", "history"];
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const supabase = supabaseUrl && supabasePublishableKey
  ? createClient(supabaseUrl, supabasePublishableKey)
  : null;

let me = {
  authenticated: false,
  authorized: false,
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
  if (!user) return null;
  const metadata = user.user_metadata || {};
  const username = metadata.full_name || metadata.name || metadata.user_name
    || user.email?.split("@")[0]
    || "Discord user";
  return {
    id: user.id,
    username,
    displayName: metadata.name || metadata.full_name || username,
    avatarUrl: metadata.avatar_url || metadata.picture || "",
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
  if (tab !== "home" && !me.authorized) {
    showToast(me.authenticated
      ? "Akun ini belum diizinkan oleh pemilik uploader."
      : "Masuk dengan Discord dulu untuk membuka bagian ini.");
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
  const authorized = !!user && me.authorized === true;
  $("#railName").textContent = user ? user.displayName || user.username : "Belum terhubung";
  $("#railHint").textContent = authorized ? `Discord · ${user.username}` : user ? "Belum diizinkan" : "Masuk untuk mulai";
  setAvatar($("#railAvatar"), user);
  setAvatar($("#topbarAvatar"), user);
  $("#topbarAvatar").hidden = !user;
  $("#authButton").textContent = user ? "Keluar" : "Masuk dengan Discord";
  $("#heroEyebrow").textContent = authorized ? "WORKSPACE AKTIF" : "RUANG AUDIO KAMU";
  $("#heroTitle").innerHTML = authorized
    ? `Halo, ${escapeHtml(user.displayName || user.username)}.<br>Mulai dari audio.`
    : user ? "Akun Discord belum<br>diizinkan." : "Audio siap.<br>Ruangnya juga.";
  $("#heroText").textContent = authorized
    ? "Pilih file, periksa creator tujuan, lalu kirim lewat Roblox Open Cloud."
    : user
      ? "Login berhasil. Minta pemilik server menambahkan akunmu ke allowlist."
      : "Unggah audio milikmu ke Roblox lewat Open Cloud. Masuk dengan Discord untuk menghubungkan workspace.";
  $("#heroAction").innerHTML = authorized
    ? "Mulai upload <span>↗</span>"
    : user ? "Keluar dari Discord" : "Masuk dengan Discord <span>↗</span>";
  $("#heroAction").onclick = () => authorized ? navigate("upload") : user ? logout() : login();
  $("#signedOutNotice").hidden = authorized;
  $("#signedOutNotice").textContent = user && !authorized
    ? "Akun Discord ini belum mendapat akses. Minta pemilik uploader menambahkan akunmu ke allowlist Supabase."
    : "Masuk memakai Discord untuk membuka upload, setup, dan riwayat. Login memakai OAuth resmi; kami tidak meminta password Discord atau Roblox.";
  $$("[data-lock]").forEach((lock) => { lock.hidden = authorized; });
  $("#railCloudDot").classList.toggle("ready", !!me.robloxConfigured);
  $("#railCloudText").textContent = me.robloxConfigured ? "Open Cloud terhubung" : "Open Cloud belum diatur";
  $("#homeCloudStatus").textContent = me.robloxConfigured ? "Open Cloud siap" : "Belum dikonfigurasi";
  $("#homeCloudCreator").textContent = me.creatorLabel || "API key disimpan di Edge Function";
  $("#setupCreator").textContent = me.creatorLabel || "Belum diatur";
  $("#setupCloudBadge").textContent = me.robloxConfigured ? "TERHUBUNG" : "BELUM AKTIF";
  $("#setupKeyBadge").textContent = me.apiKeyConfigured ? "TERSIMPAN AMAN" : "BELUM AKTIF";
  $("#uploadCloudDot").classList.toggle("ready", !!me.robloxConfigured);
  $("#uploadCloudText").textContent = me.robloxConfigured ? `Tujuan: ${me.creatorLabel}` : "Open Cloud belum dikonfigurasi di Edge Function";
  $("#reviewUpload").disabled = !authorized || !me.robloxConfigured;
}

async function loadStatus() {
  if (!me.authenticated || !supabase) {
    me.authorized = false;
    me.robloxConfigured = false;
    me.creatorLabel = "";
    updateIdentity();
    return;
  }
  const { data, error } = await supabase.functions.invoke("roblox-status");
  if (error) throw new Error(await invocationError(error));
  me.authorized = data.authorized === true;
  me.robloxConfigured = data.robloxConfigured === true;
  me.apiKeyConfigured = data.apiKeyConfigured === true;
  me.creatorLabel = typeof data.creatorLabel === "string" ? data.creatorLabel : "";
  updateIdentity();
}

async function loadHistory() {
  if (!supabase || !me.authorized) {
    history = [];
    renderHistory();
    renderRecent();
    return;
  }
  const { data, error } = await supabase
    .from("audio_uploads")
    .select("id,display_name,file_size,status,asset_id,error_message,created_at")
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) {
    showToast("Riwayat gagal dimuat dari Supabase.");
    return;
  }
  history = data;
  renderHistory();
  renderRecent();
}

async function refreshSession(session, showErrors = false) {
  me.authenticated = !!session?.user;
  me.discordUser = discordUser(session?.user);
  me.authorized = false;
  updateIdentity();
  try {
    await loadStatus();
    await loadHistory();
  } catch (error) {
    updateIdentity();
    if (showErrors) showToast(error.message);
  }
}

async function loadSession() {
  if (!supabase) {
    updateIdentity();
    showToast("Atur VITE_SUPABASE_URL dan VITE_SUPABASE_PUBLISHABLE_KEY di Cloudflare Pages.");
    return;
  }
  const { data, error } = await supabase.auth.getSession();
  if (error) {
    updateIdentity();
    showToast("Status login Supabase gagal dimuat.");
    return;
  }
  await refreshSession(data.session, true);
  supabase.auth.onAuthStateChange((_event, session) => {
    setTimeout(() => { void refreshSession(session, true); }, 0);
  });
}

async function login() {
  if (!supabase) {
    showToast("Konfigurasi Supabase belum diatur di Cloudflare Pages.");
    return;
  }
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "discord",
    options: { redirectTo: window.location.origin },
  });
  if (error) showToast(`Login Discord gagal: ${error.message}`);
}

async function logout() {
  if (!supabase) return;
  const { error } = await supabase.auth.signOut();
  if (error) {
    showToast("Tidak bisa keluar dari Discord. Coba lagi.");
    return;
  }
  me = {
    authenticated: false,
    authorized: false,
    robloxConfigured: me.robloxConfigured,
    apiKeyConfigured: me.apiKeyConfigured,
    creatorLabel: me.creatorLabel,
  };
  await refreshSession(null);
  navigate("home");
  showToast("Kamu sudah keluar.");
}

async function invocationError(error) {
  const response = error?.context;
  if (response instanceof Response) {
    const body = await response.clone().json().catch(() => null);
    if (typeof body?.error === "string") return body.error;
  }
  return error?.message || "Permintaan ke Supabase gagal.";
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
  if (!me.authorized) { showToast("Akun Discord ini belum diizinkan."); return; }
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
    const { data, error } = await supabase.functions.invoke("roblox-operation", {
      body: { uploadId },
    });
    if (error) throw new Error(await invocationError(error));
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
  if (!selectedFile || !supabase) return;
  const file = selectedFile;
  const name = $("#audioName").value.trim();
  $("#reviewUpload").disabled = true;
  $("#uploadProgress").hidden = false;
  showUploadStatus("pending", "Mengirim audio ke Roblox Open Cloud…");
  try {
    const { data, error } = await supabase.functions.invoke("roblox-upload", {
      body: file,
      headers: {
        "x-audio-name": encodeURIComponent(name),
        "x-audio-filename": encodeURIComponent(file.name),
      },
    });
    if (error) throw new Error(await invocationError(error));
    if (data.status !== "processing" || typeof data.uploadId !== "string") {
      throw new Error("Supabase tidak mengembalikan status upload yang valid.");
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
    $("#reviewUpload").disabled = !me.authorized || !me.robloxConfigured;
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
