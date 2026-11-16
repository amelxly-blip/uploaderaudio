
// ==========================================
// TERMUX BRIDGE & SPOOFER EXTENSION
// ==========================================

// Check URL params for bridge setup (e.g. ?bridge=https://...trycloudflare.com)
const urlParams = new URLSearchParams(window.location.search);
if (urlParams.get("bridge")) {
  localStorage.setItem("termux_bridge_url", urlParams.get("bridge").trim());
  window.history.replaceState({}, document.title, window.location.pathname + window.location.hash);
}

// Allow admin toggle by pressing Ctrl + Shift + B or typing in console
window.showBridgeAdmin = () => {
  const panel = document.getElementById("termuxBridgeAdminPanel");
  if (panel) panel.style.display = panel.style.display === "none" ? "block" : "none";
};
window.setBridge = (url) => {
  localStorage.setItem("termux_bridge_url", url);
  termuxBridgeUrl = url;
  void pingTermuxBridge(false);
};
document.addEventListener("keydown", (e) => {
  if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "b") {
    window.showBridgeAdmin();
  }
});

let termuxBridgeUrl = localStorage.getItem("termux_bridge_url") || "http://localhost:3000";
let spoofQueue = JSON.parse(localStorage.getItem("spoof_queue") || "[]");
let spoofHistory = JSON.parse(localStorage.getItem("spoof_history") || "[]");
let totalSpoofsCount = Number(localStorage.getItem("total_spoofs_count") || "0");

function appendSpoofLog(msg, type = "info") {
  const logEl = $("#spoofLog");
  if (!logEl) return;
  const time = new Date().toLocaleTimeString();
  const entry = document.createElement("span");
  entry.className = `spoof-log-entry ${type}`;
  entry.textContent = `[${time}] ${msg}`;
  logEl.appendChild(entry);
  logEl.scrollTop = logEl.scrollHeight;
}

function updateSpoofSummary() {
  const total = spoofQueue.length;
  const done = spoofQueue.filter(x => x.status === "completed").length;
  const fail = spoofQueue.filter(x => x.status === "error").length;
  const left = total - done - fail;

  if ($("#scTotal")) $("#scTotal").textContent = total;
  if ($("#scDone")) $("#scDone").textContent = done;
  if ($("#scFail")) $("#scFail").textContent = fail;
  if ($("#scLeft")) $("#scLeft").textContent = left;

  const pct = total > 0 ? Math.round(((done + fail) / total) * 100) : 0;
  if ($("#spoofProgressBar")) $("#spoofProgressBar").style.width = `${pct}%`;
  if ($("#spoofProgressPct")) $("#spoofProgressPct").textContent = total > 0 ? `${pct}%` : "";

  const dot = $("#spoofProgressDot");
  const sum = $("#spoofProgressSummary");
  if (dot && sum) {
    if (total === 0) {
      dot.className = "spoof-progress-dot";
      sum.textContent = "Siap · belum ada antrian";
    } else if (left === 0) {
      dot.className = `spoof-progress-dot ${fail > 0 ? "error" : "done"}`;
      sum.textContent = `Selesai · ${done} berhasil, ${fail} gagal`;
    } else {
      dot.className = "spoof-progress-dot done";
      sum.textContent = `Memproses... ${done + fail}/${total}`;
    }
  }

  const spoofStatEl = $("#totalSpoofs");
  if (spoofStatEl) {
    spoofStatEl.textContent = formatCount(totalSpoofsCount);
  }
}

function renderSpoofQueue() {
  const target = $("#spoofQueueList");
  if (!target) return;

  if (!spoofQueue.length) {
    target.innerHTML = '<div class="spoof-empty">Antrian kosong. Masukkan asset ID dan klik Mulai Spoof.</div>';
    updateSpoofSummary();
    return;
  }

  target.innerHTML = spoofQueue.map((item, idx) => {
    const num = String(idx + 1).padStart(2, "0");
    const badgeClass = item.status === "completed" ? "done" : item.status === "error" ? "error" : item.status === "working" ? "working" : "pending";
    const badgeLabel = item.status === "completed" ? "SELESAI" : item.status === "error" ? "GAGAL" : item.status === "working" ? "PROSES" : "MENUNGGU";
    const assetName = item.name ? `${escapeHtml(item.name)} · ${item.assetType || "Asset"}` : `${item.assetType || "Asset"} ID: ${item.id}`;
    const resultMarkup = item.newId
      ? `<div class="spoof-queue-result"><span class="spoof-queue-newid">ID baru: <b>${escapeHtml(item.newId)}</b></span><button class="spoof-copy-btn" type="button" data-copy-spoof-id="${escapeHtml(item.newId)}">⧉ Salin</button></div>`
      : item.error
      ? `<div class="spoof-queue-result" style="color:var(--red);font-size:10px;">${escapeHtml(item.error)}</div>`
      : '<div class="spoof-queue-result" style="color:var(--quiet);font-size:10px;">Menunggu diproses...</div>';

    return `
      <div class="spoof-queue-item">
        <div class="spoof-queue-item-head">
          <span class="spoof-queue-index">${num}</span>
          <span class="spoof-queue-id">${escapeHtml(item.id)}</span>
          <span class="spoof-queue-badge ${badgeClass}">${badgeLabel}</span>
        </div>
        <div class="spoof-queue-meta">${assetName}</div>
        ${resultMarkup}
      </div>
    `;
  }).join("");

  updateSpoofSummary();
}

// Smart Bridge Caller: first tries Cloudflare backend proxy /api/termux/, then direct bridge URL
async function callBridge(endpoint, options = {}) {
  const path = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;

  // Attempt 1: Direct bridge call (if HTTPS or on same domain / localhost)
  try {
    const res = await fetch(`${termuxBridgeUrl}${path}`, {
      ...options,
      signal: AbortSignal.timeout(45000)
    });
    if (res.ok) return await res.json();
  } catch (directErr) {
    // If blocked or failed, try via Cloudflare backend proxy
  }

  // Attempt 2: Via Cloudflare Pages Function Proxy /api/termux
  try {
    const proxyHeaders = new Headers(options.headers || {});
    proxyHeaders.set("x-termux-bridge", termuxBridgeUrl);

    const res = await fetch(`/api/termux${path}`, {
      ...options,
      headers: proxyHeaders,
      signal: AbortSignal.timeout(60000)
    });
    if (res.ok) return await res.json();
    const errData = await res.json().catch(() => null);
    throw new Error(errData?.error || `HTTP ${res.status}`);
  } catch (proxyErr) {
    throw new Error(`Koneksi ke Termux gagal: ${proxyErr.message}`);
  }
}

async function pingTermuxBridge(silent = false) {
  const dot = $("#bridgeDot");
  const label = $("#bridgeStatus");
  const url = $("#bridgeUrl") ? $("#bridgeUrl").value.trim() : termuxBridgeUrl;

  try {
    termuxBridgeUrl = url;
    localStorage.setItem("termux_bridge_url", url);
    const data = await callBridge("/api/ping");
    if (dot) dot.className = "spoof-bridge-dot ok";
    if (label) label.textContent = data.hasCookie ? "Terhubung (Bot Siap)" : "Terhubung (Cookie Belum Diset)";
    if (!silent) {
      showToast("Koneksi Termux berhasil!");
      appendSpoofLog(`Terhubung ke bridge ${url} (Cookie: ${data.hasCookie ? "Ya" : "Tidak"})`, "ok");
    }
    return true;
  } catch (err) {
    if (dot) dot.className = "spoof-bridge-dot";
    if (label) label.textContent = "Gagal terhubung";
    if (!silent) {
      showToast("Gagal terhubung ke Termux bridge.");
      appendSpoofLog(`Gagal ping: ${err.message}`, "err");
    }
    return false;
  }
}

async function startSpoofProcess() {
  const rawIds = $("#spoofIds") ? $("#spoofIds").value.trim() : "";
  if (!rawIds) {
    showToast("Masukkan setidaknya 1 Asset ID.");
    return;
  }

  const ids = rawIds.split(/[\r\n,\s]+/).map(x => x.trim()).filter(x => /^\d+$/.test(x));
  if (!ids.length) {
    showToast("Format Asset ID tidak valid. Pastikan hanya angka.");
    return;
  }

  // Quota check
  if (!vipActive && (dashboard?.quotaRemaining ?? 5) <= 0) {
    showToast("Batas kuota harian habis. Upgrade ke VIP atau tunggu reset kuota.");
    return;
  }

  const assetType = $("#spoofType") ? $("#spoofType").value : "auto";
  const speedVal = $("#spoofSpeed") ? $("#spoofSpeed").value : "1.5";

  // Build queue
  spoofQueue = ids.map(id => ({
    id,
    assetType: assetType === "auto" ? "Otomatis" : assetType === "audio" ? "Audio" : assetType === "animation" ? "Animasi" : "Decal",
    status: "working",
    name: "",
    newId: "",
    error: ""
  }));
  localStorage.setItem("spoof_queue", JSON.stringify(spoofQueue));
  renderSpoofQueue();

  const submitBtn = $("#spoofSubmitBtn");
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = "Memproses...";
  }

  appendSpoofLog(`Memulai spoof untuk ${ids.length} asset... (Speed: ${speedVal}x)`, "info");

  try {
    const data = await callBridge("/api/spoof", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ids,
        asset_type: assetType,
        speed_val: speedVal
      })
    });

    if (!data.success || !Array.isArray(data.results)) {
      throw new Error(data.error || "Gagal memproses spoof di Termux.");
    }

    let successCount = 0;
    for (const res of data.results) {
      const qItem = spoofQueue.find(x => String(x.id) === String(res.id));
      if (qItem) {
        qItem.status = res.status;
        qItem.name = res.name || "";
        qItem.newId = res.new_id || "";
        qItem.error = res.error || "";
        if (res.asset_type) qItem.assetType = res.asset_type;
      }

      if (res.status === "completed" && res.new_id) {
        successCount++;
        totalSpoofsCount++;
        localStorage.setItem("total_spoofs_count", String(totalSpoofsCount));

        // Deduct local quota if free tier
        if (!vipActive && dashboard && typeof dashboard.quotaRemaining === "number") {
          dashboard.quotaRemaining = Math.max(0, dashboard.quotaRemaining - 1);
        }

        // Add to history
        const historyEntry = {
          id: `spoof-${Date.now()}-${res.new_id}`,
          asset_id: res.new_id,
          display_name: res.name || `Spoof_${res.id}`,
          asset_type: res.asset_type || "Audio",
          status: "completed",
          file_size: 1024 * 512,
          created_at: new Date().toISOString()
        };
        spoofHistory.unshift(historyEntry);
        localStorage.setItem("spoof_history", JSON.stringify(spoofHistory.slice(0, 50)));

        if (Array.isArray(history)) {
          history.unshift(historyEntry);
          renderHistory();
          renderRecent();
        }

        appendSpoofLog(`[BERHASIL] ID: ${res.id} -> Baru: ${res.new_id} (${res.name || "Asset"})`, "ok");
      } else {
        appendSpoofLog(`[GAGAL] ID: ${res.id} (${res.error || "Error"})`, "err");
      }
    }

    localStorage.setItem("spoof_queue", JSON.stringify(spoofQueue));
    renderSpoofQueue();
    renderMembership();

    if (successCount > 0) {
      showToast(`${successCount} asset berhasil dispoof dan disimpan ke Riwayat!`);
    } else {
      showToast("Spoof selesai tetapi tidak ada asset yang berhasil.");
    }

  } catch (err) {
    appendSpoofLog(`Error: ${err.message}`, "err");
    showToast(`Spoof gagal: ${err.message}`);
    // mark pending as error
    spoofQueue.forEach(item => {
      if (item.status === "working") {
        item.status = "error";
        item.error = err.message;
      }
    });
    renderSpoofQueue();
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = "Mulai Spoof";
    }
    updateSpoofSummary();
  }
}

// YouTube Fetcher Logic
async function handleYtFetch() {
  const input = $("#ytUrl");
  const status = $("#ytFetchStatus");
  const btn = $("#ytFetchBtn");

  const url = input ? input.value.trim() : "";
  if (!url) {
    showToast("Paste link YouTube terlebih dahulu.");
    return;
  }

  if (btn) btn.disabled = true;
  if (status) {
    status.style.color = "var(--muted)";
    status.textContent = "Mengunduh audio dari YouTube via Termux (320kbps HD)...";
  }

  try {
    const data = await callBridge("/api/yt-download", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url })
    });

    if (!data.success || !data.audioBase64) {
      throw new Error(data.error || "Gagal mengunduh audio YouTube.");
    }

    // Convert base64 to File
    const byteCharacters = atob(data.audioBase64);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    const file = new File([byteArray], data.filename || "youtube_audio.mp3", { type: "audio/mpeg" });

    // Add to upload queue
    if (uploadQueue.length >= MAX_UPLOAD_QUEUE_SIZE) {
      showToast(`Antrean penuh. Maksimal ${MAX_UPLOAD_QUEUE_SIZE} file.`);
      return;
    }

    uploadQueue.push({
      file,
      name: (data.title || "YouTube Audio").slice(0, 50),
      assetType: "Audio",
      playbackSpeed: Number($("#playbackSpeed") ? $("#playbackSpeed").value : 0.43),
      status: "queued",
      assetId: "",
      error: ""
    });

    renderUploadQueue();
    if (input) input.value = "";
    if (status) {
      status.style.color = "var(--green)";
      status.textContent = `✔ Berhasil! "${data.title}" ditambahkan ke antrean upload.`;
    }
    showToast("Audio YouTube berhasil diambil dan masuk antrean!");

  } catch (err) {
    if (status) {
      status.style.color = "var(--red)";
      status.textContent = `✘ Gagal: ${err.message}`;
    }
    showToast(`YouTube Fetch Error: ${err.message}`);
  } finally {
    if (btn) btn.disabled = false;
  }
}

function initSpoofAndYt() {
  if ($("#bridgeUrl")) {
    $("#bridgeUrl").value = termuxBridgeUrl;
  }

  $("#bridgePingBtn")?.addEventListener("click", () => pingTermuxBridge(false));
  $("#bridgeSaveUrl")?.addEventListener("click", () => pingTermuxBridge(false));
  $("#spoofSubmitBtn")?.addEventListener("click", startSpoofProcess);

  $("#spoofClearQueue")?.addEventListener("click", () => {
    spoofQueue = [];
    localStorage.removeItem("spoof_queue");
    renderSpoofQueue();
    showToast("Antrian spoof dibersihkan.");
  });

  $("#spoofClearLog")?.addEventListener("click", () => {
    const logEl = $("#spoofLog");
    if (logEl) logEl.innerHTML = '<span class="spoof-log-entry info">[ Log dibersihkan ]</span>';
  });

  $("#spoofCopyNewIds")?.addEventListener("click", async () => {
    const newIds = spoofQueue.filter(x => x.newId).map(x => x.newId).join("\n");
    if (!newIds) {
      showToast("Belum ada ID baru untuk disalin.");
      return;
    }
    await navigator.clipboard.writeText(newIds);
    showToast("Semua ID baru disalin ke clipboard!");
  });

  $("#spoofExportTxt")?.addEventListener("click", () => {
    const lines = spoofQueue.map(x => `${x.id} -> ${x.newId || "FAILED"} (${x.name || x.assetType})`).join("\n");
    const blob = new Blob([lines], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `spoof_results_${Date.now()}.txt`;
    a.click();
  });

  $("#spoofExportCsv")?.addEventListener("click", () => {
    const csv = "ID_Asli,ID_Baru,Nama,Tipe,Status\n" + spoofQueue.map(x => `"${x.id}","${x.newId || ""}","${(x.name || "").replace(/"/g, '""')}","${x.assetType}","${x.status}"`).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `spoof_results_${Date.now()}.csv`;
    a.click();
  });

  $("#spoofExportJson")?.addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(spoofQueue, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `spoof_results_${Date.now()}.json`;
    a.click();
  });

  $("#spoofQueueList")?.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-copy-spoof-id]");
    if (btn) {
      await navigator.clipboard.writeText(btn.dataset.copySpoofId);
      showToast(`ID ${btn.dataset.copySpoofId} disalin!`);
    }
  });

  $("#ytFetchBtn")?.addEventListener("click", handleYtFetch);
  $("#ytUrl")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleYtFetch();
    }
  });

  renderSpoofQueue();
  void pingTermuxBridge(true);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initSpoofAndYt);
} else {
  initSpoofAndYt();
}
