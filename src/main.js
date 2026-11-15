import { getCompensationSpeed, processAudioForPlaybackSpeed } from "./audio-processing.js";
import { filterUploadHistory } from "./history-filter.js";
import { getMembershipBadge } from "./membership-badge.js";
import {
  buildSkyboxAtlasPrompt,
  buildSkyboxRbxmx,
  getSkyboxAtlasCells,
  normalizeSkyAssetId,
  SKYBOX_FACES,
  SKYBOX_PROMPTS,
} from "./skybox.js";
import { getNextQuotaResetAt } from "../supabase/functions/_shared/quota-window.js";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));
const tabs = ["home", "upload", "skybox", "setup", "history"];
const VIP_WHATSAPP_NUMBER = "6282174905591";
const MAX_UPLOAD_QUEUE_SIZE = 10;
const MAX_SKYBOX_ATLAS_SIZE = 20 * 1024 * 1024;
const MAX_SKYBOX_BATCH_SIZE = 20 * 1024 * 1024;
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
let uploadQueue = [];
let nextQueueItemId = 1;
let selectedAssetType = "Audio";
let uploadInProgress = false;
let toastTimer;
let history = [];
let dashboard = null;
let publicStats = null;
const skyPreviewTimers = new Map();
const skyPreviewVersions = new Map();
const skyPreviewObjectUrls = new Map();
let skyAtlasFiles = [];
let skyboxBatch = null;
let skyboxBusy = false;
let pendingSkyboxBatch = null;
let skyRenderer = null;
let skyOrbitRotationX = 0;
let skyOrbitRotationY = 0;

function createQueueItem(file, assetType) {
  const extension = file.name.split(".").pop().toLowerCase();
  const previewUrl = assetType === "Audio" || assetType === "Decal"
    ? URL.createObjectURL(file)
    : null;
  return {
    id: nextQueueItemId++,
    file,
    assetType,
    name: file.name.replace(/\.[^.]+$/, "").slice(0, 50),
    playbackSpeed: Number($("#playbackSpeed").value),
    previewUrl,
    status: "queued",
    error: "",
    assetId: "",
  };
}

function releaseQueueItem(item) {
  if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
}

function queueItemStatus(item) {
  return ({
    queued: "Menunggu",
    uploading: "Mengunggah",
    processing: "Diproses Roblox",
    completed: "Selesai",
    failed: "Gagal",
  })[item.status] || "Menunggu";
}

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

function formatCount(value) {
  const count = Number(value);
  return Number.isFinite(count) && count >= 0 ? Math.floor(count).toLocaleString("id-ID") : "—";
}

function formatCountdown(remainingMs) {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours}j ${String(minutes).padStart(2, "0")}m ${String(seconds).padStart(2, "0")}d`;
}

function renderMembership() {
  const signedIn = me.authenticated && !!me.discordUser;
  const statistics = dashboard || publicStats;
  const expiresAt = dashboard?.vipExpiresAt ? Date.parse(dashboard.vipExpiresAt) : NaN;
  const vipActive = Boolean(dashboard?.isVip && Number.isFinite(expiresAt) && expiresAt > Date.now());
  const badge = getMembershipBadge({
    signedIn,
    isVip: vipActive,
    quotaRemaining: dashboard?.quotaRemaining,
  });
  const badgeCard = $("#heroPlanCard");
  badgeCard.hidden = !signedIn;
  badgeCard.classList.toggle("vip", vipActive);
  $("#heroPlanLabel").textContent = badge.label;
  $("#heroPlanValue").textContent = badge.value;
  const plan = $("#membershipPlan");
  plan.classList.toggle("vip", vipActive);
  $("#membershipTitle").textContent = vipActive ? "Premium" : "Gratis";
  const nextQuotaReset = dashboard?.nextQuotaResetAt
    ? Date.parse(dashboard.nextQuotaResetAt)
    : NaN;
  const resetHint = $("#quotaResetHint");
  const quotaResetText = Number.isFinite(nextQuotaReset) && nextQuotaReset > Date.now()
    ? `1 upload pulih dalam ${formatCountdown(nextQuotaReset - Date.now())}`
    : "";
  resetHint.hidden = !signedIn || vipActive || !quotaResetText;
  resetHint.textContent = quotaResetText;
  $("#membershipCopy").textContent = !signedIn
    ? "Masuk dengan Discord untuk melihat kuota upload akun."
    : vipActive
      ? "Upload tanpa batas aplikasi selama masa Premium aktif."
      : `Sisa ${formatCount(dashboard?.quotaRemaining)} dari 5 upload dalam 24 jam.`;
  const expiry = $("#membershipExpiry");
  expiry.hidden = !vipActive;
  if (vipActive) {
    const remaining = Math.max(0, expiresAt - Date.now());
    const days = Math.floor(remaining / 86_400_000);
    const hours = Math.floor((remaining % 86_400_000) / 3_600_000);
    const minutes = Math.floor((remaining % 3_600_000) / 60_000);
    const seconds = Math.floor((remaining % 60_000) / 1000);
    expiry.textContent = `Berakhir dalam ${days} hari ${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  $("#buyVipButton").hidden = !signedIn;
  $("#membershipUploadButton").hidden = !signedIn;
  const quotaTitle = $("#uploadQuotaTitle");
  const quotaValue = $("#uploadQuotaValue");
  const quotaReset = $("#uploadQuotaReset");
  if (!signedIn) {
    quotaTitle.textContent = "Kuota upload";
    quotaValue.textContent = "Masuk untuk melihat";
    quotaReset.textContent = "Batas gratis: 5 percobaan dalam 24 jam.";
  } else if (vipActive) {
    quotaTitle.textContent = "Paket VIP";
    quotaValue.textContent = "UNLIMITED";
    quotaReset.textContent = "VIP aktif · tidak ada batas upload aplikasi.";
  } else {
    quotaTitle.textContent = "Sisa kuota gratis";
    quotaValue.textContent = `${formatCount(dashboard?.quotaRemaining)}/5`;
    quotaReset.textContent = quotaResetText || "Kuota dihitung dalam jendela 24 jam berjalan.";
  }
  $("#totalVisitors").textContent = formatCount(statistics?.totalVisitors);
  $("#totalVip").textContent = formatCount(statistics?.totalVip);
  $("#totalUploads").textContent = formatCount(statistics?.totalUploads);
}

function updatePlaybackSpeedHelp() {
  const speed = Number($("#playbackSpeed").value);
  $("#speedHelp").textContent =
    `Audio dipercepat ${getCompensationSpeed(speed).toFixed(2)}× sebelum upload. Atur Sound.PlaybackSpeed ke ${speed.toFixed(2)} agar terdengar normal.`;
}

function setAssetType(assetType) {
  if (uploadInProgress || !Object.prototype.hasOwnProperty.call(assetTypes, assetType)) return;
  selectedAssetType = assetType;
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
  $("#audioSpeedControl").hidden = assetType !== "Audio";
  $("#reviewDialogTitle").textContent = `Periksa sebelum upload ${assetType.toLowerCase()}`;
  $("#reviewDialogCopy").textContent =
    "Setiap file akan membuat asset baru di Roblox dan menggunakan satu percobaan kuota.";
  $("#rightsConfirmText").textContent = details.rights;
  $("#uploadAsideSubtitle").textContent =
    `${assetType} baru dibuat di akun atau grup yang diizinkan API key. Kuota aplikasi 5 upload per 24 jam dipakai bersama.`;
}

function navigate(tab) {
  if (!tabs.includes(tab)) return;
  if (tab !== "home" && tab !== "skybox" && !me.authenticated) {
    showToast("Masuk dengan Discord dulu untuk membuka bagian ini.");
    return;
  }
  $$(".page").forEach((page) => page.classList.toggle("active", page.id === `page-${tab}`));
  $$("[data-tab]").forEach((button) => button.classList.toggle("active", button.dataset.tab === tab));
  document.body.classList.toggle("skybox-wide", tab === "skybox");
  if (tab === "skybox") resizeSkyboxScene();
  $("#topbarLabel").textContent = `AUDIO WORKSPACE / ${({ home: "BERANDA", upload: "UPLOAD", skybox: "SKYBOX", setup: "SETUP ROBLOX", history: "RIWAYAT" })[tab]}`;
  if (tab === "history") void loadHistory();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function renderSkyPrompt() {
  $("#skyPromptText").value = buildSkyboxAtlasPrompt($("#skyPromptPreset").value);
}

function populateSkyPromptPresets() {
  const select = $("#skyPromptPreset");
  select.replaceChildren(...SKYBOX_PROMPTS.map(({ id, name, description }) => {
    const option = document.createElement("option");
    option.value = id;
    option.textContent = name;
    option.title = description;
    return option;
  }));
}

function openSkyPromptDialog() {
  renderSkyPrompt();
  $("#skyPromptDialog").showModal();
}

function drawSkyboxScene() {
  if (!skyRenderer) return;
  const { gl, canvas, uniforms, program } = skyRenderer;
  gl.useProgram(program);
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.uniform2f(uniforms.resolution, canvas.width, canvas.height);
  gl.uniform1f(uniforms.yaw, skyOrbitRotationY * Math.PI / 180);
  gl.uniform1f(uniforms.pitch, skyOrbitRotationX * Math.PI / 180);
  gl.drawArrays(gl.TRIANGLES, 0, 6);
}

function resizeSkyboxScene() {
  if (!skyRenderer) return;
  const { canvas, gl } = skyRenderer;
  const bounds = canvas.getBoundingClientRect();
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.round(bounds.width * ratio));
  const height = Math.max(1, Math.round(bounds.height * ratio));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
    gl.viewport(0, 0, width, height);
  }
  drawSkyboxScene();
}

function initializeSkyboxScene() {
  const canvas = $("#skyboxPreviewCanvas");
  const fallback = $("#skyboxPreviewFallback");
  try {
    const gl = canvas.getContext("webgl", {
      alpha: false,
      antialias: false,
      powerPreference: "low-power",
    });
    if (!gl) throw new Error("WebGL is unavailable.");

    const vertexSource = `
      attribute vec2 aPosition;
      varying vec2 vUv;
      void main() {
        vUv = aPosition * 0.5 + 0.5;
        gl_Position = vec4(aPosition, 0.0, 1.0);
      }
    `;
    const fragmentSource = `
      precision highp float;
      varying vec2 vUv;
      uniform vec2 uResolution;
      uniform float uYaw;
      uniform float uPitch;
      uniform sampler2D uFt;
      uniform sampler2D uBk;
      uniform sampler2D uLf;
      uniform sampler2D uRt;
      uniform sampler2D uUp;
      uniform sampler2D uDn;
      void main() {
        vec2 screen = vUv * 2.0 - 1.0;
        screen.x *= uResolution.x / uResolution.y;
        screen *= 0.78;
        vec3 ray = normalize(vec3(screen.x, screen.y, -1.0));
        float cp = cos(uPitch);
        float sp = sin(uPitch);
        ray = vec3(ray.x, ray.y * cp - ray.z * sp, ray.y * sp + ray.z * cp);
        float cy = cos(uYaw);
        float sy = sin(uYaw);
        ray = vec3(ray.x * cy - ray.z * sy, ray.y, ray.x * sy + ray.z * cy);
        float ax = abs(ray.x);
        float ay = abs(ray.y);
        float az = abs(ray.z);
        vec2 uv;
        vec3 color;
        if (az >= ax && az >= ay) {
          if (ray.z < 0.0) {
            uv = vec2(0.5 + ray.x / (2.0 * az), 0.5 + ray.y / (2.0 * az));
            color = texture2D(uFt, uv).rgb;
          } else {
            uv = vec2(0.5 - ray.x / (2.0 * az), 0.5 + ray.y / (2.0 * az));
            color = texture2D(uBk, uv).rgb;
          }
        } else if (ax >= ay) {
          if (ray.x > 0.0) {
            uv = vec2(0.5 + ray.z / (2.0 * ax), 0.5 + ray.y / (2.0 * ax));
            color = texture2D(uRt, uv).rgb;
          } else {
            uv = vec2(0.5 - ray.z / (2.0 * ax), 0.5 + ray.y / (2.0 * ax));
            color = texture2D(uLf, uv).rgb;
          }
        } else if (ray.y > 0.0) {
          uv = vec2(0.5 + ray.x / (2.0 * ay), 0.5 - ray.z / (2.0 * ay));
          color = texture2D(uUp, uv).rgb;
        } else {
          uv = vec2(0.5 + ray.x / (2.0 * ay), 0.5 + ray.z / (2.0 * ay));
          color = texture2D(uDn, uv).rgb;
        }
        gl_FragColor = vec4(color, 1.0);
      }
    `;
    const compile = (type, source) => {
      const shader = gl.createShader(type);
      if (!shader) throw new Error("Could not create a WebGL shader.");
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const message = gl.getShaderInfoLog(shader);
        gl.deleteShader(shader);
        throw new Error(message || "Could not compile a WebGL shader.");
      }
      return shader;
    };
    const vertexShader = compile(gl.VERTEX_SHADER, vertexSource);
    const fragmentShader = compile(gl.FRAGMENT_SHADER, fragmentSource);
    const program = gl.createProgram();
    if (!program) throw new Error("Could not create the WebGL preview program.");
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(program) || "Could not link the WebGL preview program.");
    }

    const buffer = gl.createBuffer();
    if (!buffer) throw new Error("Could not create the WebGL preview buffer.");
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW,
    );
    const position = gl.getAttribLocation(program, "aPosition");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

    const uniforms = {
      resolution: gl.getUniformLocation(program, "uResolution"),
      yaw: gl.getUniformLocation(program, "uYaw"),
      pitch: gl.getUniformLocation(program, "uPitch"),
    };
    const textures = new Map();
    SKYBOX_FACES.forEach((face, index) => {
      const texture = gl.createTexture();
      if (!texture) throw new Error("Could not create a WebGL face texture.");
      textures.set(face.key, texture);
      gl.activeTexture(gl.TEXTURE0 + index);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        1,
        1,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        new Uint8Array([34, 37, 43, 255]),
      );
      gl.uniform1i(gl.getUniformLocation(program, `u${face.key}`), index);
    });
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    skyRenderer = { gl, canvas, program, uniforms, textures, textureSources: new Map() };
    fallback.hidden = true;
    canvas.hidden = false;
    if ("ResizeObserver" in window) {
      new ResizeObserver(resizeSkyboxScene).observe(canvas);
    } else {
      window.addEventListener("resize", resizeSkyboxScene);
    }
    resizeSkyboxScene();
  } catch (error) {
    console.error("Could not initialize the immersive Skybox preview.", error);
    canvas.hidden = true;
    fallback.hidden = false;
  }
}

function setSkyboxTexture(faceKey, source) {
  if (!skyRenderer) return;
  const { gl, textures, textureSources } = skyRenderer;
  textureSources.set(faceKey, source || "");
  const texture = textures.get(faceKey);
  if (!texture) return;
  gl.activeTexture(gl.TEXTURE0 + SKYBOX_FACES.findIndex((face) => face.key === faceKey));
  gl.bindTexture(gl.TEXTURE_2D, texture);
  if (!source) {
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      1,
      1,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      new Uint8Array([34, 37, 43, 255]),
    );
    drawSkyboxScene();
    return;
  }
  const image = new Image();
  image.decoding = "async";
  image.onload = () => {
    if (textureSources.get(faceKey) !== source) return;
    gl.activeTexture(gl.TEXTURE0 + SKYBOX_FACES.findIndex((face) => face.key === faceKey));
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    drawSkyboxScene();
  };
  image.onerror = () => {
    if (textureSources.get(faceKey) === source) {
      console.error("Could not load a Skybox texture for the 3D preview.");
    }
  };
  image.src = source;
}

function setSkyPreviewMessage(faceKey, message) {
  const preview = $(`[data-sky-preview="${faceKey}"]`);
  const image = preview.querySelector("img");
  const objectUrl = skyPreviewObjectUrls.get(faceKey);
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  skyPreviewObjectUrls.delete(faceKey);
  image.onerror = null;
  image.hidden = true;
  image.removeAttribute("src");
  setSkyboxTexture(faceKey, "");
  preview.querySelector("span").textContent = message;
}

function setSkyPreviewImage(faceKey, objectUrl) {
  const preview = $(`[data-sky-preview="${faceKey}"]`);
  const image = preview.querySelector("img");
  const oldUrl = skyPreviewObjectUrls.get(faceKey);
  if (oldUrl && oldUrl !== objectUrl) URL.revokeObjectURL(oldUrl);
  skyPreviewObjectUrls.set(faceKey, objectUrl);
  image.onerror = () => {
    console.error("Could not display a Skybox face preview.");
    setSkyPreviewMessage(faceKey, "Preview tidak tersedia");
  };
  image.src = objectUrl;
  image.hidden = false;
  preview.querySelector("span").textContent = "";
  setSkyboxTexture(faceKey, objectUrl);
}

async function loadSkyPreview(faceKey, assetId, version) {
  const preview = $(`[data-sky-preview="${faceKey}"]`);
  try {
    const response = await fetch(`/api/roblox-thumbnail?assetId=${encodeURIComponent(assetId)}`, {
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`Thumbnail Roblox gagal dimuat (${response.status}).`);
    const blob = await response.blob();
    if (!blob.type.toLowerCase().startsWith("image/")) {
      throw new Error("Roblox tidak mengembalikan file gambar untuk pratinjau.");
    }
    if (skyPreviewVersions.get(faceKey) !== version) return;
    const objectUrl = URL.createObjectURL(blob);
    setSkyPreviewImage(faceKey, objectUrl);
    const image = preview.querySelector("img");
    image.onerror = () => {
      if (skyPreviewVersions.get(faceKey) !== version) return;
      console.error("Could not display a Roblox skybox image preview.");
      setSkyPreviewMessage(faceKey, "Preview tidak tersedia");
    };
  } catch (error) {
    if (skyPreviewVersions.get(faceKey) !== version) return;
    console.error("Could not load a Roblox skybox image preview.", error);
    setSkyPreviewMessage(faceKey, "Preview tidak tersedia");
  }
}

function scheduleSkyPreview(faceKey, value) {
  clearTimeout(skyPreviewTimers.get(faceKey));
  const version = (skyPreviewVersions.get(faceKey) || 0) + 1;
  skyPreviewVersions.set(faceKey, version);
  const assetId = normalizeSkyAssetId(value);
  if (!assetId) {
    setSkyPreviewMessage(faceKey, "Pratinjau gambar");
    return;
  }
  setSkyPreviewMessage(faceKey, "Memuat preview...");
  skyPreviewTimers.set(faceKey, setTimeout(() => {
    void loadSkyPreview(faceKey, assetId, version);
  }, 350));
}

function resetSkyCube() {
  skyOrbitRotationX = 0;
  skyOrbitRotationY = 0;
  drawSkyboxScene();
}

function setSkyboxAtlasStatus(type, message) {
  const status = $("#skyboxAtlasStatus");
  status.className = `skybox-atlas-status${type ? ` ${type}` : ""}`;
  status.textContent = message;
}

function setSkyFaceStatus(faceKey, state, message) {
  const status = $(`[data-sky-status="${faceKey}"]`);
  status.dataset.state = state;
  status.textContent = message;
}

function updateSkyboxControls() {
  const hasAtlas = skyAtlasFiles.length === SKYBOX_FACES.length;
  const faceIds = Object.fromEntries(SKYBOX_FACES.map(({ key }) => [
    key,
    normalizeSkyAssetId($(`[data-sky-id="${key}"]`).value),
  ]));
  const allIdsAvailable = SKYBOX_FACES.every(({ key }) => Boolean(faceIds[key]));
  const batchComplete = !skyboxBatch
    || (skyboxBatch.status === "completed"
      && SKYBOX_FACES.every(({ key }) => skyboxBatch.faces[key]?.status === "completed"));

  $("#uploadSkyAtlas").disabled = skyboxBusy
    || !hasAtlas
    || !me.authenticated
    || !me.robloxConfigured
    || skyboxBatch?.status !== "ready";
  $("#clearSkyAtlas").disabled = skyboxBusy || !hasAtlas;
  $("#refreshSkyAtlasStatus").hidden = skyboxBusy
    || !SKYBOX_FACES.some(({ key }) =>
      skyboxBatch?.faces[key]?.status === "processing" && skyboxBatch.faces[key].uploadId
    );
  $("#generateSkyFile").disabled = skyboxBusy || !allIdsAvailable || !batchComplete;
  $("#skyAtlasInput").disabled = skyboxBusy;
  $$("[data-sky-id]").forEach((input) => { input.disabled = skyboxBusy; });
}

async function decodeAtlasImage(file) {
  if ("createImageBitmap" in window) return createImageBitmap(file);

  const objectUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = objectUrl;
    await image.decode();
    return image;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function canvasToJpeg(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Browser gagal memproses salah satu gambar Sky."));
    }, "image/jpeg", 0.9);
  });
}

async function prepareSkyboxAtlas(file) {
  if (skyboxBusy || !file) return;
  $("#skyboxAtlasFileLabel").textContent = file.name;
  if (file.size === 0 || file.size > MAX_SKYBOX_ATLAS_SIZE) {
    setSkyboxAtlasStatus("error", "File atlas harus lebih dari 0 dan maksimal 20 MB.");
    return;
  }
  if (!/\.(png|jpe?g|webp)$/i.test(file.name)) {
    setSkyboxAtlasStatus("error", "Pilih atlas PNG, JPG, JPEG, atau WebP.");
    return;
  }

  let source;
  try {
    source = await decodeAtlasImage(file);
    const cells = getSkyboxAtlasCells(source.width, source.height);
    const baseName = file.name.replace(/\.[^.]+$/, "")
      .normalize("NFKD")
      .replace(/[^\w-]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 32) || "Skybox";
    const files = [];
    let totalSize = 0;
    for (const cell of cells) {
      const canvas = document.createElement("canvas");
      canvas.width = cell.width;
      canvas.height = cell.height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Browser tidak bisa membuka kanvas pemotong gambar.");
      context.fillStyle = "#15171a";
      context.fillRect(0, 0, cell.width, cell.height);
      context.drawImage(
        source,
        cell.x,
        cell.y,
        cell.width,
        cell.height,
        0,
        0,
        cell.width,
        cell.height,
      );
      const blob = await canvasToJpeg(canvas);
      totalSize += blob.size;
      if (totalSize > MAX_SKYBOX_BATCH_SIZE) {
        throw new Error("Total enam gambar hasil potong melebihi 20 MB. Pilih atlas yang lebih ringan.");
      }
      files.push(new File([blob], `${baseName}_${cell.key}.jpg`, {
        type: "image/jpeg",
        lastModified: Date.now(),
      }));
    }

    skyAtlasFiles.forEach((face) => {
      const oldUrl = skyPreviewObjectUrls.get(face.key);
      if (oldUrl) URL.revokeObjectURL(oldUrl);
    });
    skyAtlasFiles = files.map((file, index) => ({
      file,
      key: cells[index].key,
      name: file.name,
      size: file.size,
    }));
    skyboxBatch = {
      status: "ready",
      faces: Object.fromEntries(SKYBOX_FACES.map(({ key }) => [key, { status: "ready" }])),
    };
    $("#skyboxAtlasFileLabel").textContent = file.name;
    for (const face of skyAtlasFiles) {
      const objectUrl = URL.createObjectURL(face.file);
      setSkyPreviewImage(face.key, objectUrl);
      setSkyFaceStatus(face.key, "ready", `${formatSize(face.size)} · Siap ditinjau`);
    }
    setSkyboxAtlasStatus(
      "success",
      `Atlas ${source.width} × ${source.height} dipotong menjadi enam gambar (${formatSize(totalSize)} total).`,
    );
    $("#skyAtlasInput").value = "";
    updateSkyboxControls();
  } catch (error) {
    setSkyboxAtlasStatus("error", error.message || "Atlas tidak bisa diproses.");
  } finally {
    if (source && typeof source.close === "function") source.close();
  }
}

function clearSkyboxAtlas() {
  if (skyboxBusy) return;
  skyAtlasFiles.forEach((face) => {
    const objectUrl = skyPreviewObjectUrls.get(face.key);
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    skyPreviewObjectUrls.delete(face.key);
  });
  skyAtlasFiles = [];
  skyboxBatch = null;
  $("#skyAtlasInput").value = "";
  $("#skyboxAtlasFileLabel").textContent = "Pilih atau taruh satu gambar atlas di sini";
  setSkyboxAtlasStatus("", "");
  for (const { key } of SKYBOX_FACES) {
    const id = normalizeSkyAssetId($(`[data-sky-id="${key}"]`).value);
    if (id) {
      setSkyFaceStatus(key, "ready", `Asset ID ${id}`);
      scheduleSkyPreview(key, id);
    } else {
      setSkyFaceStatus(key, "empty", "Menunggu gambar");
      setSkyPreviewMessage(key, "Pratinjau gambar");
    }
  }
  updateSkyboxControls();
}

function openSkyboxReview() {
  if (!me.authenticated) {
    showToast("Masuk dengan Discord dulu untuk mengunggah skybox.");
    return;
  }
  if (!me.robloxConfigured) {
    showToast("Atur Creator ID dan API key Roblox di Setup sebelum upload.");
    return;
  }
  if (skyAtlasFiles.length !== SKYBOX_FACES.length || skyboxBatch?.status !== "ready") {
    setSkyboxAtlasStatus("error", "Pilih dan periksa atlas sebelum memulai upload.");
    return;
  }
  const name = $("#skyboxName").value.trim();
  if (!name || name.length > 50) {
    setSkyboxAtlasStatus("error", "Nama Sky harus berisi 1 sampai 50 karakter.");
    $("#skyboxName").focus();
    return;
  }

  pendingSkyboxBatch = { name, files: [...skyAtlasFiles] };
  $("#reviewDialogTitle").textContent = "Konfirmasi upload skybox";
  $("#reviewDialogCopy").textContent =
    "Setiap sisi akan dibuat sebagai asset gambar baru di Roblox. Periksa file dan creator sebelum mengirim.";
  $("#reviewCreator").textContent = creatorDisplayName() || "Creator Roblox yang terhubung";
  $("#reviewQueueList").innerHTML = pendingSkyboxBatch.files.map((face) => {
    const definition = SKYBOX_FACES.find(({ key }) => key === face.key);
    return `<div class="review-queue-item"><strong>${escapeHtml(definition.label)} · ${escapeHtml(face.name)}</strong><span>Decal · ${escapeHtml(formatSize(face.size))}</span></div>`;
  }).join("");
  $("#reviewCount").textContent =
    "6 asset Roblox. Batch ini memakai 1 percobaan kuota aplikasi; kuota Roblox tetap berlaku.";
  $("#reviewPlaybackSpeedRow").hidden = true;
  $("#rightsConfirmText").textContent =
    "Saya berhak mengunggah gambar ini dan paham Roblox dapat meninjau atau menolak keenam asset.";
  $("#rightsConfirm").checked = false;
  $("#confirmUpload").textContent = "Setujui dan upload 6 sisi";
  $("#confirmUpload").disabled = true;
  $("#confirmDialog").showModal();
}

function handleSkyboxStreamEvent(event, pollPromises) {
  if (event.type === "complete") return;
  if (event.type === "heartbeat") return;
  if (event.type === "fatal") return;
  const face = skyboxBatch?.faces[event.faceKey];
  if (!face) throw new Error("Server mengembalikan sisi Sky yang tidak dikenal.");

  if (event.status === "processing" && typeof event.uploadId === "string") {
    face.status = "processing";
    face.uploadId = event.uploadId;
    setSkyFaceStatus(event.faceKey, "processing", "Diproses oleh Roblox");
    updateSkyboxControls();
    pollPromises.push(pollSkyboxFace(event.faceKey, event.uploadId));
    return;
  }
  if (event.status === "failed" && typeof event.error === "string") {
    face.status = "failed";
    face.error = event.error;
    setSkyFaceStatus(event.faceKey, "failed", event.error);
    updateSkyboxControls();
    return;
  }
  throw new Error("Server mengembalikan status sisi Sky yang tidak valid.");
}

async function pollSkyboxFace(faceKey, uploadId) {
  const face = skyboxBatch?.faces[faceKey];
  if (!face) return;
  try {
    const result = await pollOperation(uploadId, "Decal", false);
    if (result.status === "completed") {
      face.status = "completed";
      face.assetId = result.assetId;
      $(`[data-sky-id="${faceKey}"]`).value = result.assetId;
      setSkyFaceStatus(faceKey, "completed", `Selesai · Asset ID ${result.assetId}`);
    } else {
      face.status = "processing";
      setSkyFaceStatus(faceKey, "processing", "Masih diproses · gunakan Periksa status lagi");
    }
  } catch (error) {
    face.status = "failed";
    face.error = error.message || "Roblox menolak gambar ini.";
    setSkyFaceStatus(faceKey, "failed", face.error);
  }
  updateSkyboxControls();
}

async function submitSkyboxBatch(batch) {
  if (!batch || skyboxBusy) return;
  skyboxBusy = true;
  skyboxBatch.status = "uploading";
  for (const { key } of SKYBOX_FACES) {
    skyboxBatch.faces[key] = { status: "uploading" };
    setSkyFaceStatus(key, "uploading", "Mengirim ke Roblox");
  }
  setSkyboxAtlasStatus("", "Mengirim keenam sisi ke creator yang dipilih...");
  updateSkyboxControls();

  const form = new FormData();
  form.append("displayName", batch.name);
  for (const face of batch.files) form.append(`face_${face.key}`, face.file, face.name);
  const pollPromises = [];
  let serverCompleted = false;
  try {
    const response = await fetch("/api/functions/roblox-skybox-upload", {
      method: "POST",
      body: form,
      cache: "no-store",
      credentials: "same-origin",
    });
    if (!response.ok) {
      const data = await response.json().catch(() => null);
      throw new Error(typeof data?.error === "string" ? data.error : "Batch upload ditolak oleh server.");
    }
    if (!response.headers.get("Content-Type")?.toLowerCase().includes("text/event-stream") || !response.body) {
      throw new Error("Layanan upload tidak mengembalikan progress batch yang valid.");
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
      let separator = buffer.match(/\r?\n\r?\n/);
      while (separator) {
        const boundary = separator.index;
        const message = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + separator[0].length);
        const dataLine = message.split(/\r?\n/).find((line) => line.startsWith("data:"));
        if (dataLine) {
          const event = JSON.parse(dataLine.slice(5).trim());
          if (event.type === "complete") serverCompleted = true;
          if (event.type === "fatal") {
            throw new Error(event.error || "Batch Skybox gagal diproses.");
          }
          handleSkyboxStreamEvent(event, pollPromises);
        }
        separator = buffer.match(/\r?\n\r?\n/);
      }
      if (done) break;
    }
    if (!serverCompleted) throw new Error("Progress batch terputus sebelum semua gambar selesai dikirim.");
    await Promise.all(pollPromises);

    const states = SKYBOX_FACES.map(({ key }) => skyboxBatch.faces[key]?.status);
    if (states.every((state) => state === "completed")) {
      skyboxBatch.status = "completed";
      setSkyboxAtlasStatus("success", "Keenam gambar selesai. Asset ID sudah terpasang dan file Sky siap diunduh.");
    } else if (states.some((state) => state === "processing")) {
      skyboxBatch.status = "processing";
      setSkyboxAtlasStatus("", "Sebagian gambar masih diproses Roblox. Periksa status lagi sebelum mengunduh.");
    } else {
      skyboxBatch.status = "failed";
      setSkyboxAtlasStatus("error", "Batch selesai dengan sisi gagal. Periksa status tiap sisi dan riwayat upload.");
    }
  } catch (error) {
    await Promise.all(pollPromises);
    if (skyboxBatch) {
      for (const { key } of SKYBOX_FACES) {
        const face = skyboxBatch.faces[key];
        if (face?.status === "uploading") {
          face.status = "unknown";
          setSkyFaceStatus(key, "failed", "Status belum diterima · periksa riwayat sebelum upload ulang");
        }
      }
      skyboxBatch.status = "failed";
    }
    setSkyboxAtlasStatus("error", error.message || "Batch Skybox gagal dikirim.");
  } finally {
    skyboxBusy = false;
    updateSkyboxControls();
    await loadHistory();
    if (me.authenticated) {
      try {
        await loadDashboard();
      } catch (error) {
        if (error.status === 403) await clearBlockedSession();
        else showToast(`Status kuota belum diperbarui: ${error.message}`);
      }
    }
  }
}

async function refreshSkyboxStatus() {
  if (skyboxBusy || !skyboxBatch) return;
  const pending = SKYBOX_FACES.filter(({ key }) =>
    skyboxBatch.faces[key]?.status === "processing" && skyboxBatch.faces[key].uploadId
  );
  if (!pending.length) return;
  skyboxBusy = true;
  setSkyboxAtlasStatus("", "Memeriksa status gambar yang masih diproses...");
  updateSkyboxControls();
  await Promise.all(pending.map(({ key }) => pollSkyboxFace(key, skyboxBatch.faces[key].uploadId)));
  const states = SKYBOX_FACES.map(({ key }) => skyboxBatch.faces[key]?.status);
  if (states.every((state) => state === "completed")) {
    skyboxBatch.status = "completed";
    setSkyboxAtlasStatus("success", "Keenam gambar selesai. Asset ID sudah terpasang dan file Sky siap diunduh.");
  } else {
    skyboxBatch.status = states.some((state) => state === "failed") ? "failed" : "processing";
    setSkyboxAtlasStatus("", "Beberapa gambar masih diproses. Periksa status lagi nanti.");
  }
  skyboxBusy = false;
  updateSkyboxControls();
  await loadHistory();
}

function downloadSkyboxFile() {
  const result = $("#skyboxResult");
  if (skyboxBusy || (skyboxBatch && skyboxBatch.status !== "completed")) {
    result.className = "skybox-result";
    result.textContent = "Unduhan aktif setelah keenam gambar selesai diunggah ke Roblox.";
    return;
  }
  const faceIds = Object.fromEntries(SKYBOX_FACES.map(({ key }) => [
    key,
    $(`[data-sky-id="${key}"]`).value,
  ]));
  try {
    const name = $("#skyboxName").value.trim();
    const xml = buildSkyboxRbxmx(name, faceIds);
    const blob = new Blob([xml], { type: "application/xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const filename = name.normalize("NFKD").replace(/[^\w-]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || "Skybox";
    link.href = url;
    link.download = `${filename}.rbxmx`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    result.className = "skybox-result success";
    result.textContent = `${filename}.rbxmx diunduh. Di Studio, klik kanan Lighting lalu pilih Insert from File.`;
  } catch (error) {
    result.className = "skybox-result";
    result.textContent = error.message;
    showToast(error.message);
  }
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
    ? dashboard?.isVip
      ? "Upload audio, decal, dan model lewat Roblox Open Cloud dengan kuota aplikasi tanpa batas."
      : "Pilih file dan kirim lewat Roblox Open Cloud. Akun gratis mendapat 5 upload per 24 jam."
    : "Unggah audio milikmu ke Roblox lewat Open Cloud. Masuk dengan Discord untuk menghubungkan workspace.";
  $("#heroAction").innerHTML = signedIn
    ? "Mulai upload <span>↗</span>"
    : "Masuk dengan Discord <span>↗</span>";
  $("#heroAction").onclick = () => signedIn ? navigate("upload") : login();
  $("#signedOutNotice").hidden = signedIn;
  $("#signedOutNotice").textContent =
    "Masuk dengan Discord untuk membuka upload, setup, dan riwayat. Paket gratis mendapat 5 upload per 24 jam.";
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
  renderMembership();
  updateSkyboxControls();
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
    const error = new Error(typeof data?.error === "string" ? data.error : "Permintaan ke layanan uploader gagal.");
    error.status = response.status;
    throw error;
  }
  if (!data || typeof data !== "object") {
    throw new Error("Layanan uploader mengembalikan respons yang tidak valid.");
  }
  return data;
}

async function loadDashboard() {
  if (!me.authenticated) return;
  const data = await callFunction("site-dashboard", {});
  if (
    !data
    || !Number.isFinite(Number(data.totalVisitors))
    || !Number.isFinite(Number(data.totalVip))
    || !Number.isFinite(Number(data.totalUploads))
    || typeof data.isVip !== "boolean"
    || (data.nextQuotaResetAt != null && typeof data.nextQuotaResetAt !== "string")
  ) {
    throw new Error("Ringkasan dashboard dari server tidak valid.");
  }
  dashboard = data;
  publicStats = {
    totalVisitors: data.totalVisitors,
    totalVip: data.totalVip,
    totalUploads: data.totalUploads,
  };
  renderMembership();
  $("#heroText").textContent = data.isVip
    ? "Upload audio, decal, dan model lewat Roblox Open Cloud dengan kuota aplikasi tanpa batas."
    : "Pilih file dan kirim lewat Roblox Open Cloud. Akun gratis mendapat 5 upload per 24 jam.";
}

async function loadPublicStats() {
  const response = await fetch("/api/public/stats", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
    cache: "no-store",
    credentials: "omit",
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(typeof data?.error === "string" ? data.error : "Statistik situs gagal dimuat.");
  }
  if (
    !data
    || !Number.isFinite(Number(data.totalVisitors))
    || !Number.isFinite(Number(data.totalVip))
    || !Number.isFinite(Number(data.totalUploads))
  ) {
    throw new Error("Statistik situs dari server tidak valid.");
  }
  publicStats = data;
  if (!me.authenticated) renderMembership();
}

async function clearBlockedSession() {
  await fetch("/api/auth/logout", {
    method: "POST",
    cache: "no-store",
    credentials: "same-origin",
  }).catch(() => {});
  me.authenticated = false;
  me.discordUser = null;
  me.robloxConfigured = false;
  me.apiKeyConfigured = false;
  me.creatorType = "user";
  me.creatorId = "";
  me.creatorLabel = "";
  me.robloxProfile = null;
  dashboard = null;
  clearQueue();
  $("#robloxCredentialsForm").reset();
  history = [];
  renderHistory();
  renderRecent();
  updateIdentity();
  showToast("Akun Discord ini diblokir dari web.");
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
    dashboard = null;
    me.robloxConfigured = false;
    me.apiKeyConfigured = false;
    me.creatorType = "user";
    me.creatorId = "";
    me.creatorLabel = "";
    me.robloxProfile = null;
    clearQueue();
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
    dashboard = null;
    me.robloxConfigured = false;
    me.apiKeyConfigured = false;
    me.creatorType = "user";
    me.creatorId = "";
    me.creatorLabel = "";
    clearQueue();
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
    await loadDashboard();
    await loadStatus();
    await loadHistory();
  } catch (error) {
    if (error.status === 403) {
      await clearBlockedSession();
      return;
    }
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
  if (!me.authenticated) {
    try {
      await loadPublicStats();
    } catch (error) {
      console.error("Could not load public site statistics.", error);
      showToast(error.message);
    }
  }
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
  dashboard = null;
  clearQueue();
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
  $("#clearQueue").disabled = isBusy;
  $("#playbackSpeed").disabled = isBusy;
  $$("[data-asset-type]").forEach((button) => { button.disabled = isBusy; });
  renderUploadQueue();
}

function clearUploadStatus() {
  $("#uploadStatus").className = "status-message";
  $("#uploadStatus").textContent = "";
  $("#uploadProgress").hidden = true;
}

function clearQueue() {
  uploadQueue.forEach(releaseQueueItem);
  uploadQueue = [];
  $("#fileInput").value = "";
  renderUploadQueue();
  clearUploadStatus();
}

function renderUploadQueue() {
  const panel = $("#queuePanel");
  const list = $("#uploadQueue");
  panel.hidden = uploadQueue.length === 0;
  const waitingCount = uploadQueue.filter((item) => item.status === "queued").length;
  $("#queueCount").textContent =
    `${uploadQueue.length} file · ${waitingCount} menunggu`;
  const previewFor = (item) => {
    if (item.assetType === "Audio" && item.previewUrl) {
      return `<div class="queue-preview"><audio controls preload="metadata" src="${item.previewUrl}"></audio></div>`;
    }
    if (item.assetType === "Decal" && item.previewUrl && !item.file.name.toLowerCase().endsWith(".tga")) {
      return `<div class="queue-preview"><img src="${item.previewUrl}" alt="Pratinjau ${escapeHtml(item.file.name)}"></div>`;
    }
    if (item.assetType === "Decal") {
      return '<div class="queue-preview"><div class="queue-model-preview">Pratinjau browser tidak tersedia untuk file TGA. Nama dan ukuran file tetap bisa diperiksa.</div></div>';
    }
    if (item.assetType === "Model") {
      return '<div class="queue-preview"><div class="queue-model-preview">File model Roblox siap diunggah. Pratinjau 3D tersedia di Roblox Studio.</div></div>';
    }
    return "";
  };
  list.innerHTML = uploadQueue.map((item) => {
    const details = assetTypes[item.assetType];
    const removeDisabled = uploadInProgress;
    const retry = item.status === "failed"
      ? `<button class="queue-clear" type="button" data-retry-queue="${item.id}">Coba lagi</button>`
      : "";
    const result = item.assetId
      ? `<span class="queue-item-id">Asset ID ${escapeHtml(item.assetId)}</span>`
      : `<span>${queueItemStatus(item)}</span>`;
    return `<article class="queue-item" data-queue-item="${item.id}">
      <div class="queue-item-head">
        <div class="queue-item-icon">${details.icon}</div>
        <div class="queue-item-copy"><div class="queue-item-file">${escapeHtml(item.file.name)}</div>
          <div class="queue-item-meta">${item.assetType} · ${escapeHtml(formatSize(item.file.size))}</div>
        </div>
        <button class="queue-item-remove" type="button" data-remove-queue="${item.id}" aria-label="Hapus ${escapeHtml(item.file.name)}" ${removeDisabled ? "disabled" : ""}>×</button>
      </div>
      <input class="queue-item-name" type="text" maxlength="50" value="${escapeHtml(item.name)}" aria-label="Nama asset untuk ${escapeHtml(item.file.name)}" data-queue-name="${item.id}" ${uploadInProgress ? "disabled" : ""}>
      ${previewFor(item)}
      <div class="queue-item-footer">${result}${retry}${item.error ? `<div class="queue-item-error">${escapeHtml(item.error)}</div>` : ""}</div>
    </article>`;
  }).join("");
  $("#clearQueue").disabled = uploadInProgress || uploadQueue.length === 0;
  $("#reviewUpload").disabled = uploadInProgress
    || !me.authenticated
    || !me.robloxConfigured
    || !uploadQueue.some((item) => item.status === "queued");
}

function handleFiles(files) {
  if (uploadInProgress || files.length === 0) return;
  let added = 0;
  const errors = [];
  for (const file of files) {
    if (uploadQueue.length >= MAX_UPLOAD_QUEUE_SIZE) {
      errors.push(`Antrean maksimal ${MAX_UPLOAD_QUEUE_SIZE} file.`);
      break;
    }
    const extension = file.name.split(".").pop().toLowerCase();
    const validExtensions = {
      Audio: ["mp3", "ogg", "wav", "flac"],
      Decal: ["png", "jpg", "jpeg", "bmp", "tga"],
      Model: ["rbxm", "rbxmx"],
    }[selectedAssetType];
    if (!validExtensions.includes(extension)) {
      errors.push(`${file.name}: format tidak sesuai untuk ${selectedAssetType}.`);
      continue;
    }
    if (file.size === 0 || file.size > 20 * 1024 * 1024) {
      errors.push(`${file.name}: ukuran file harus lebih dari 0 dan maksimal 20 MB.`);
      continue;
    }
    uploadQueue.push(createQueueItem(file, selectedAssetType));
    added += 1;
  }
  $("#fileInput").value = "";
  renderUploadQueue();
  if (added > 0) clearUploadStatus();
  if (errors.length) showUploadStatus("error", errors.join(" "));
}

function openReview() {
  if (!me.authenticated) { showToast("Masuk dengan Discord dulu."); return; }
  if (!me.robloxConfigured) {
    showUploadStatus("error", "Konfigurasi Roblox belum lengkap. Atur Creator ID dan API key di Setup Roblox.");
    return;
  }
  const pending = uploadQueue.filter((item) => item.status === "queued");
  if (!pending.length) { showUploadStatus("error", "Tambahkan file ke antrean lebih dulu."); return; }
  for (const item of pending) {
    const nameInput = $(`[data-queue-name="${item.id}"]`);
    const name = nameInput.value.trim();
    if (!name || name.length > 50) {
      showUploadStatus("error", `Isi nama asset (maksimal 50 karakter) untuk ${item.file.name}.`);
      nameInput.focus();
      return;
    }
    item.name = name;
  }
  if (!uploadQueue.some((item) => item.status === "queued")) {
    showUploadStatus("error", "Tidak ada file yang menunggu upload.");
    return;
  }
  pendingSkyboxBatch = null;
  $("#confirmUpload").textContent = "Konfirmasi upload";
  $("#reviewCreator").textContent = creatorDisplayName() || "Creator Roblox yang terhubung";
  $("#rightsConfirmText").textContent =
    "Saya memiliki hak untuk mengunggah semua file di antrean dan memahami Roblox dapat meninjau atau menolaknya.";
  $("#reviewQueueList").innerHTML = pending.map((item) =>
    `<div class="review-queue-item"><strong>${escapeHtml(item.name)}</strong><span>${item.assetType} · ${escapeHtml(formatSize(item.file.size))}</span></div>`
  ).join("");
  $("#reviewCount").textContent = `${pending.length} file akan diunggah satu per satu.`;
  const audioSpeeds = [...new Set(pending
    .filter((item) => item.assetType === "Audio")
    .map((item) => item.playbackSpeed))];
  $("#reviewPlaybackSpeedRow").hidden = audioSpeeds.length === 0;
  $("#reviewPlaybackSpeed").textContent = audioSpeeds.map((speed) =>
    `${speed.toFixed(2)}× di Roblox (audio ${getCompensationSpeed(speed).toFixed(2)}×)`
  ).join(" · ");
  $("#rightsConfirm").checked = false;
  $("#confirmUpload").disabled = true;
  $("#confirmDialog").showModal();
}

async function pollOperation(uploadId, assetType, refreshHistory = true) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 2500));
    const data = await callFunction("roblox-operation", { body: { uploadId } });
    if (data.status === "completed") {
      if (refreshHistory) await loadHistory();
      return { status: "completed", assetId: String(data.assetId || "") };
    }
    if (data.status === "failed") throw new Error(data.error || "Roblox menolak upload.");
  }
  if (refreshHistory) await loadHistory();
  return { status: "processing", assetId: "" };
}

async function submitUpload() {
  $("#confirmDialog").close();
  const pending = uploadQueue.filter((item) => item.status === "queued");
  if (!pending.length) return;
  setUploadBusy(true);
  $("#uploadProgress").hidden = false;
  let completedCount = 0;
  let failedCount = 0;
  try {
    for (const [index, item] of pending.entries()) {
      item.status = "uploading";
      item.error = "";
      renderUploadQueue();
      showUploadStatus("pending", `Mengunggah ${index + 1}/${pending.length}: ${item.name}`);
      $("#uploadProgress").hidden = false;
      try {
        const uploadFile = item.assetType === "Audio"
          ? await processAudioForPlaybackSpeed(item.file, item.playbackSpeed)
          : item.file;
        const data = await callFunction("roblox-upload", {
          body: uploadFile,
          headers: {
            "x-audio-name": encodeURIComponent(item.name),
            "x-audio-filename": encodeURIComponent(uploadFile.name),
            "x-asset-type": item.assetType,
          },
        });
        if (data.status !== "processing" || typeof data.uploadId !== "string") {
          throw new Error("Layanan uploader tidak mengembalikan status upload yang valid.");
        }
        const result = await pollOperation(data.uploadId, item.assetType);
        item.status = result.status;
        item.assetId = result.assetId;
        if (result.status === "completed") {
          completedCount += 1;
        } else {
          item.error = "Roblox masih memproses. Periksa riwayat untuk status terbaru.";
        }
      } catch (error) {
        item.status = "failed";
        item.error = error.message || "Upload gagal.";
        failedCount += 1;
        if (error.status === 429) {
          renderUploadQueue();
          showUploadStatus("error", "Kuota 24 jam tercapai. File berikutnya tetap menunggu; coba lagi setelah kuota pulih.");
          break;
        }
      } finally {
        renderUploadQueue();
        await loadHistory();
      }
    }
    const waitingCount = uploadQueue.filter((item) => item.status === "queued").length;
    if (waitingCount) {
      showUploadStatus("pending", `${completedCount} selesai, ${failedCount} gagal. ${waitingCount} file masih menunggu.`);
    } else if (failedCount) {
      showUploadStatus("error", `${completedCount} selesai, ${failedCount} gagal. Periksa detail antrean atau coba lagi.`);
    } else {
      showUploadStatus("success", `${completedCount} upload selesai.`);
    }
  } finally {
    $("#uploadProgress").hidden = true;
    setUploadBusy(false);
    await loadHistory();
    if (me.authenticated) {
      try {
        await loadDashboard();
      } catch (error) {
        if (error.status === 403) await clearBlockedSession();
        else showToast(`Status kuota belum diperbarui: ${error.message}`);
      }
    }
  }
  renderUploadQueue();
}

function renderHistory() {
  const target = $("#historyContainer");
  const visibleHistory = filterUploadHistory(history, {
    query: $("#historySearch").value,
    assetType: $("#historyTypeFilter").value,
  });
  $("#historyCount").textContent = visibleHistory.length === history.length
    ? `${history.length} asset`
    : `${visibleHistory.length} dari ${history.length} asset`;
  if (!history.length) {
    target.innerHTML = '<div class="history-empty"><div class="track-icon">♫</div><p>Belum ada upload. Asset ID akan muncul setelah Roblox menyelesaikan operasi.</p></div>';
    return;
  }
  if (!visibleHistory.length) {
    target.innerHTML = '<div class="history-no-results">Tidak ada upload yang cocok dengan pencarian atau filter ini.</div>';
    return;
  }
  const cards = visibleHistory.map((item) => {
    const label = item.status === "completed" ? "Selesai" : item.status === "processing" ? "Diproses" : "Gagal";
    const statusClass = item.status === "completed" ? "success" : item.status === "processing" ? "pending" : "error";
    const size = Number(item.file_size) || 0;
    const date = item.created_at ? new Date(item.created_at).toLocaleString("id-ID") : "—";
    const type = ["Audio", "Decal", "Model"].includes(item.asset_type) ? item.asset_type : "Audio";
    const icon = type === "Audio" ? "♫" : type === "Decal" ? "▧" : "⬡";
    const assetId = item.asset_id ? String(item.asset_id) : "";
    const assetIdMarkup = assetId
      ? `<span class="history-asset-id">ID ${escapeHtml(assetId)}</span><button class="copy-id-button" type="button" data-copy-asset-id="${escapeHtml(assetId)}">Salin ID</button>`
      : '<span class="history-asset-id">Asset ID belum tersedia</span>';
    return `<article class="history-card">
      <div class="history-card-head">
        <div class="track-icon">${icon}</div>
        <div class="history-card-copy">
          <div class="history-card-name">${escapeHtml(item.display_name)}</div>
          <div class="history-card-meta">${type} · ${escapeHtml(formatSize(size))}<br>${escapeHtml(date)}</div>
        </div>
        <span class="history-badge ${statusClass}">${label}</span>
      </div>
      <div class="history-card-detail">${assetIdMarkup}</div>
    </article>`;
  }).join("");
  target.innerHTML = `<div class="history-grid">${cards}</div>`;
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
$("#authButton").addEventListener("click", () => {
  if (uploadInProgress) {
    showToast("Tunggu antrean upload selesai sebelum keluar.");
    return;
  }
  if (me.authenticated) void logout();
  else void login();
});
function openVipDialog() {
  if (!me.authenticated || !me.discordUser) {
    showToast("Masuk dengan Discord dulu untuk membeli VIP.");
    return;
  }
  $("#vipDialog").showModal();
}
$("#buyVipButton").addEventListener("click", openVipDialog);
$("#quickBuyVip").addEventListener("click", openVipDialog);
$("#closeVipDialog").addEventListener("click", () => $("#vipDialog").close());
$$("[data-open-sky-prompts]").forEach((button) => button.addEventListener("click", openSkyPromptDialog));
populateSkyPromptPresets();
$("#openSkyPrompts").addEventListener("click", openSkyPromptDialog);
$("#closeSkyPrompts").addEventListener("click", () => $("#skyPromptDialog").close());
$("#skyPromptPreset").addEventListener("change", renderSkyPrompt);
$("#copySkyPrompt").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText($("#skyPromptText").value);
    showToast("Prompt skybox disalin.");
  } catch (error) {
    console.error("Could not copy the skybox prompt.", error);
    showToast("Prompt tidak bisa disalin otomatis. Pilih teks prompt lalu salin manual.");
  }
});
$$("[data-sky-id]").forEach((input) => {
  input.addEventListener("input", () => {
    const faceKey = input.dataset.skyId;
    const assetId = normalizeSkyAssetId(input.value);
    if (!skyboxBatch) {
      setSkyFaceStatus(faceKey, assetId ? "ready" : "empty", assetId ? `Asset ID ${assetId}` : "Menunggu gambar");
    }
    scheduleSkyPreview(faceKey, input.value);
    updateSkyboxControls();
  });
});
$("#skyAtlasInput").addEventListener("change", (event) => {
  const [file] = event.target.files || [];
  if (file) void prepareSkyboxAtlas(file);
});
const skyboxAtlasDrop = $("#skyboxAtlasDrop");
skyboxAtlasDrop.addEventListener("dragover", (event) => {
  event.preventDefault();
  skyboxAtlasDrop.dataset.dragover = "true";
});
skyboxAtlasDrop.addEventListener("dragleave", () => { delete skyboxAtlasDrop.dataset.dragover; });
skyboxAtlasDrop.addEventListener("drop", (event) => {
  event.preventDefault();
  delete skyboxAtlasDrop.dataset.dragover;
  const [file] = event.dataTransfer.files || [];
  if (file) {
    $("#skyboxAtlasFileLabel").textContent = file.name;
    void prepareSkyboxAtlas(file);
  }
});
$("#uploadSkyAtlas").addEventListener("click", openSkyboxReview);
$("#clearSkyAtlas").addEventListener("click", clearSkyboxAtlas);
$("#refreshSkyAtlasStatus").addEventListener("click", () => void refreshSkyboxStatus());
const skyboxOrbitStage = $("#skyboxOrbitStage");
initializeSkyboxScene();
let skyOrbitPointerId = null;
let skyOrbitPointerX = 0;
let skyOrbitPointerY = 0;
skyboxOrbitStage.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;
  skyOrbitPointerId = event.pointerId;
  skyOrbitPointerX = event.clientX;
  skyOrbitPointerY = event.clientY;
  skyboxOrbitStage.dataset.dragging = "true";
  skyboxOrbitStage.setPointerCapture(event.pointerId);
});
skyboxOrbitStage.addEventListener("pointermove", (event) => {
  if (event.pointerId !== skyOrbitPointerId) return;
  skyOrbitRotationY += (event.clientX - skyOrbitPointerX) * 0.45;
  skyOrbitRotationX = Math.max(-80, Math.min(80, skyOrbitRotationX - (event.clientY - skyOrbitPointerY) * 0.45));
  skyOrbitPointerX = event.clientX;
  skyOrbitPointerY = event.clientY;
  drawSkyboxScene();
});
const finishSkyOrbitDrag = (event) => {
  if (event.pointerId !== skyOrbitPointerId) return;
  skyOrbitPointerId = null;
  delete skyboxOrbitStage.dataset.dragging;
};
skyboxOrbitStage.addEventListener("pointerup", finishSkyOrbitDrag);
skyboxOrbitStage.addEventListener("pointercancel", finishSkyOrbitDrag);
skyboxOrbitStage.addEventListener("keydown", (event) => {
  const step = event.shiftKey ? 20 : 10;
  if (event.key === "ArrowLeft") skyOrbitRotationY -= step;
  else if (event.key === "ArrowRight") skyOrbitRotationY += step;
  else if (event.key === "ArrowUp") skyOrbitRotationX = Math.min(80, skyOrbitRotationX + step);
  else if (event.key === "ArrowDown") skyOrbitRotationX = Math.min(80, skyOrbitRotationX - step);
  else return;
  event.preventDefault();
  drawSkyboxScene();
});
$("#resetSkyOrbit").addEventListener("click", resetSkyCube);
$("#generateSkyFile").addEventListener("click", downloadSkyboxFile);
$$("[data-vip-days]").forEach((button) => {
  button.addEventListener("click", () => {
    const days = Number(button.dataset.vipDays);
    const price = Number(button.dataset.vipPrice);
    const duration = days === 7 ? "1 minggu" : days === 30 ? "1 bulan" : "2 bulan";
    const amount = new Intl.NumberFormat("id-ID").format(price);
    const message = [
      "Halo, saya ingin premium di web anda.",
      `Paket: ${duration} (${days} hari).`,
      `Nominal: Rp${amount}.`,
      `Discord: ${me.discordUser.displayName} (@${me.discordUser.username})`,
      `Discord ID: ${me.discordUser.id}.`,
    ].join("\n");
    const url = `https://wa.me/${VIP_WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;
    $("#vipDialog").close();
    window.open(url, "_blank", "noopener,noreferrer");
  });
});
$("#fileInput").addEventListener("change", (event) => handleFiles(Array.from(event.target.files || [])));
$("#clearQueue").addEventListener("click", clearQueue);
$("#uploadQueue").addEventListener("input", (event) => {
  const input = event.target.closest("[data-queue-name]");
  if (!input) return;
  const item = uploadQueue.find((entry) => entry.id === Number(input.dataset.queueName));
  if (item) item.name = input.value;
});
$("#uploadQueue").addEventListener("click", (event) => {
  const removeButton = event.target.closest("[data-remove-queue]");
  if (removeButton && !uploadInProgress) {
    const itemId = Number(removeButton.dataset.removeQueue);
    const item = uploadQueue.find((entry) => entry.id === itemId);
    if (item) releaseQueueItem(item);
    uploadQueue = uploadQueue.filter((entry) => entry.id !== itemId);
    renderUploadQueue();
    return;
  }
  const retryButton = event.target.closest("[data-retry-queue]");
  if (retryButton && !uploadInProgress) {
    const item = uploadQueue.find((entry) => entry.id === Number(retryButton.dataset.retryQueue));
    if (item?.status === "failed") {
      item.status = "queued";
      item.error = "";
      renderUploadQueue();
    }
  }
});
$("#dropzone").addEventListener("dragover", (event) => { event.preventDefault(); $("#dropzone").classList.add("dragging"); });
$("#dropzone").addEventListener("dragleave", () => $("#dropzone").classList.remove("dragging"));
$("#dropzone").addEventListener("drop", (event) => {
  event.preventDefault();
  $("#dropzone").classList.remove("dragging");
  handleFiles(Array.from(event.dataTransfer.files || []));
});
$("#reviewUpload").addEventListener("click", openReview);
$("#robloxCredentialsForm").addEventListener("submit", saveRobloxCredentials);
$("#disconnectRoblox").addEventListener("click", disconnectRoblox);
$("#playbackSpeed").addEventListener("change", updatePlaybackSpeedHelp);
$("#cancelReview").addEventListener("click", () => {
  pendingSkyboxBatch = null;
  $("#confirmUpload").textContent = "Konfirmasi upload";
  $("#confirmDialog").close();
});
$("#rightsConfirm").addEventListener("change", (event) => { $("#confirmUpload").disabled = !event.target.checked; });
$("#confirmUpload").addEventListener("click", () => {
  const batch = pendingSkyboxBatch;
  pendingSkyboxBatch = null;
  if (batch) {
    $("#confirmDialog").close();
    void submitSkyboxBatch(batch);
  } else {
    void submitUpload();
  }
});
$("#historySearch").addEventListener("input", renderHistory);
$("#historyTypeFilter").addEventListener("change", renderHistory);
$("#historyContainer").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-copy-asset-id]");
  if (!button) return;
  try {
    await navigator.clipboard.writeText(button.dataset.copyAssetId);
    showToast("Asset ID disalin.");
  } catch (error) {
    console.error("Could not copy Roblox asset ID.", error);
    showToast("Asset ID tidak bisa disalin. Salin teks ID secara manual.");
  }
});
buildWaveform();
updatePlaybackSpeedHelp();
setAssetType("Audio");
renderUploadQueue();
updateSkyboxControls();
updateIdentity();
void loadSession();
setInterval(() => {
  if (!me.authenticated) return;
  void loadDashboard().catch(async (error) => {
    if (error.status === 403) await clearBlockedSession();
    else console.error("Dashboard heartbeat failed.", error);
  });
}, 30_000);
setInterval(renderMembership, 1000);
setTimeout(() => {
  const boot = $("#boot");
  boot.classList.add("done");
  setTimeout(() => {
    boot.hidden = true;
    boot.setAttribute("aria-hidden", "true");
  }, 600);
}, 550);
