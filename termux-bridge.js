const http = require('http');
const https = require('https');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = process.env.PORT || 3000;
const SPOOF_SCRIPT = path.join(os.homedir(), 'spoofer_bot_runner.py');
const YT_SCRIPT = path.join(os.homedir(), 'yt_uploader_runner.py');
const CONFIG_FILE = path.join(os.homedir(), '.uploader_config.json');

function ensureSpoofRunner() {
    const script = `
import sys, json, asyncio, os, time, shutil, subprocess
from pathlib import Path
import aiohttp
import requests

DL_DIR = Path.home() / "spoof_tmp"
os.makedirs(DL_DIR, exist_ok=True)
ASSET_TYPE_IDS = {1: 'Image', 3: 'Audio', 4: 'Mesh', 9: 'Place', 10: 'Model', 13: 'Decal', 24: 'Animation', 38: 'Plugin', 40: 'MeshPart', 62: 'Video'}
SPEED_MAP = {"1": 0.8, "2": 1.0, "3": 1.2, "4": 1.5, "5": 1.8, "6": 2.0, "7": 2.3, "8": 2.5, "9": 3.0}

def load_config():
    p = Path.home() / ".uploader_config.json"
    if p.exists():
        try: return json.loads(p.read_text())
        except: pass
    return {}

async def get_asset_details(session, aid, headers):
    name, asset_type_name = None, None
    try:
        async with session.get(f'https://economy.roblox.com/v2/assets/{aid}/details', headers=headers, timeout=aiohttp.ClientTimeout(total=8)) as r:
            if r.status == 200:
                d = await r.json(content_type=None)
                name = d.get('name') or d.get('Name')
                tid = d.get('assetTypeId') or d.get('AssetTypeId')
                asset_type_name = ASSET_TYPE_IDS.get(tid)
    except: pass
    if not name:
        try:
            async with session.get(f'https://develop.roblox.com/v1/assets?assetIds={aid}', headers=headers, timeout=aiohttp.ClientTimeout(total=8)) as r:
                if r.status == 200:
                    d = await r.json(content_type=None)
                    if d.get('data'):
                        name = d['data'][0].get('Name')
                        if not asset_type_name: asset_type_name = ASSET_TYPE_IDS.get(d['data'][0].get('AssetTypeId'))
        except: pass
    if not name:
        try:
            async with session.get(f'https://apis.roblox.com/toolbox-service/v1/items/details?assetIds={aid}', headers=headers, timeout=aiohttp.ClientTimeout(total=8)) as r:
                if r.status == 200:
                    d = await r.json(content_type=None)
                    items = d.get('data', [])
                    if items:
                        asset = items[0].get('asset', {})
                        name = asset.get('name')
                        if not asset_type_name: asset_type_name = ASSET_TYPE_IDS.get(asset.get('typeId'))
        except: pass
    return name, asset_type_name

async def download_asset(session, aid, headers, out_path):
    cdns = [
        f"https://assetdelivery.roblox.com/v1/asset/?id={aid}",
        f"https://assetdelivery.roblox.com/v2/asset?id={aid}",
        f"https://c6.rbxcdn.com/{aid}",
        f"https://c7.rbxcdn.com/{aid}"
    ]
    for url in cdns:
        try:
            async with session.get(url, headers=headers, timeout=aiohttp.ClientTimeout(total=15)) as r:
                if r.status == 200:
                    data = await r.read()
                    if len(data) > 200:
                        with open(out_path, 'wb') as f: f.write(data)
                        return True
        except: pass
    return False

def detect_file_type(file_path):
    try:
        with open(file_path, 'rb') as f: header = f.read(64)
        if header.startswith(b'ID3') or header[:2] == bytes([0xff, 0xfb]) or header[:2] == bytes([0xff, 0xf3]): return 'Audio', '.mp3'
        if header.startswith(b'OggS'): return 'Audio', '.ogg'
        if header.startswith(b'RIFF') and b'WAVE' in header: return 'Audio', '.wav'
        if header.startswith(bytes([0x89, 0x50, 0x4e, 0x47])): return 'Decal', '.png'
        if header.startswith(b'<roblox!') or header.startswith(b'<roblox'): return 'Animation', '.rbxm'
    except: pass
    return 'Audio', '.mp3'

def process_speed(file_path, speed_val):
    if not speed_val: return file_path
    try:
        v = float(speed_val)
        if v == 1.0 or v <= 0: return file_path
    except: return file_path
    out_path = str(file_path) + "_speed.mp3"
    try:
        new_rate = int(44100 * v)
        filter_str = f"asetrate={new_rate},aresample=44100"
        subprocess.run(["ffmpeg","-y","-i",str(file_path),"-filter:a",filter_str,"-b:a","320k","-ar","44100",out_path],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
        if os.path.exists(out_path) and os.path.getsize(out_path) > 0:
            return out_path
    except: pass
    return file_path

async def upload_asset(session, file_path, aid, name, asset_type, api_key, user_id):
    url = "https://apis.roblox.com/assets/v1/assets"
    h = {"x-api-key": api_key.strip()}
    clean_name = re.sub(r'[^a-zA-Z0-9_\- ]', '', (name or f"Asset_{aid}"))[:50].strip() or f"Asset_{aid}"
    req_meta = {
        "assetType": asset_type,
        "displayName": clean_name,
        "description": f"Spoofed {asset_type} ID: {aid}",
        "creationContext": {"creator": {"userId": str(user_id)}}
    }
    data = aiohttp.FormData()
    data.add_field('request', json.dumps(req_meta), content_type='application/json')
    data.add_field('fileContent', open(file_path, 'rb'), filename=os.path.basename(file_path))
    try:
        async with session.post(url, headers=h, data=data, timeout=aiohttp.ClientTimeout(total=45)) as r:
            res = await r.json(content_type=None)
            op_id = res.get("operationId") or res.get("path")
            if not op_id: return None
            for _ in range(15):
                await asyncio.sleep(2)
                op_url = f"https://apis.roblox.com/assets/v1/{op_id}" if not op_id.startswith("http") else op_id
                async with session.get(op_url, headers=h, timeout=aiohttp.ClientTimeout(total=10)) as op_r:
                    if op_r.status == 200:
                        op_res = await op_r.json(content_type=None)
                        if op_res.get("done"):
                            return op_res.get("response", {}).get("assetId")
    except: pass
    return None

async def main():
    if len(sys.argv) < 2: return
    try:
        payload = json.loads(sys.argv[1])
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        return

    ids = payload.get("ids", [])
    speed_val = payload.get("speed_val")
    forced_type = payload.get("asset_type", "auto")
    cfg = load_config()
    api_key = payload.get("api_key") or cfg.get("api_key")
    user_id = payload.get("user_id") or cfg.get("user_id")
    cookie = cfg.get("cookie", "")

    headers = {"User-Agent": "Roblox/WinInet", "Accept": "application/json"}
    if cookie: headers["Cookie"] = f".ROBLOSECURITY={cookie.strip()}"

    results = []
    async with aiohttp.ClientSession() as session:
        for aid in ids:
            aid = str(aid).strip()
            if not aid: continue
            raw_file = DL_DIR / f"{aid}_raw"
            ok = await download_asset(session, aid, headers, raw_file)
            if not ok:
                results.append({"id": aid, "status": "error", "error": "Download failed"})
                continue

            name, detected_type = await get_asset_details(session, aid, headers)
            file_type, ext = detect_file_type(raw_file)
            asset_type = detected_type or file_type
            if forced_type and forced_type != "auto":
                if forced_type.lower() == "audio": asset_type = "Audio"
                elif forced_type.lower() == "animation": asset_type = "Animation"
                elif forced_type.lower() == "decal": asset_type = "Decal"

            final_file = raw_file
            if asset_type == "Audio":
                final_file = process_speed(raw_file, speed_val)

            new_id = await upload_asset(session, final_file, aid, name, asset_type, api_key, user_id)
            try: os.remove(raw_file)
            except: pass
            if final_file != raw_file:
                try: os.remove(final_file)
                except: pass

            if new_id:
                results.append({"id": aid, "name": name or f"Asset_{aid}", "asset_type": asset_type, "new_id": str(new_id), "status": "completed"})
            else:
                results.append({"id": aid, "name": name or f"Asset_{aid}", "asset_type": asset_type, "status": "error", "error": "Upload failed"})

    print(json.dumps(results))

if __name__ == '__main__':
    asyncio.run(main())
`;
    fs.writeFileSync(SPOOF_SCRIPT, script);
}

function ensureYTRunner() {
    const script = `
import sys, json, os, subprocess
from pathlib import Path
import yt_dlp
import base64

DL_DIR = Path.home() / "yt_tmp_bridge"
os.makedirs(DL_DIR, exist_ok=True)

def main():
    if len(sys.argv) < 2: return
    try: payload = json.loads(sys.argv[1])
    except: return
    url = payload.get("url")
    if not url: return

    out_tmpl = str(DL_DIR / "%(title)s.%(ext)s")
    ydl_opts = {
        'format': 'bestaudio/best',
        'outtmpl': out_tmpl,
        'postprocessors': [{
            'key': 'FFmpegExtractAudio',
            'preferredcodec': 'mp3',
            'preferredquality': '320',
        }],
        'quiet': True,
        'no_warnings': True,
    }
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=True)
            title = info.get('title', 'YouTube_Audio')
            filename = ydl.prepare_filename(info).rsplit('.', 1)[0] + '.mp3'
            if not os.path.exists(filename):
                mp3s = [str(DL_DIR / f) for f in os.listdir(DL_DIR) if f.endswith('.mp3')]
                if mp3s: filename = max(mp3s, key=os.path.getmtime)

            if os.path.exists(filename):
                with open(filename, 'rb') as f:
                    b64 = base64.b64encode(f.read()).decode('utf-8')
                sz = os.path.getsize(filename)
                try: os.remove(filename)
                except: pass
                print(json.dumps({
                    "success": True,
                    "title": title,
                    "filename": f"{title[:40]}.mp3",
                    "audioBase64": b64,
                    "size": sz
                }))
                return
    except Exception as e:
        print(json.dumps({"success": False, "error": str(e)}))

if __name__ == '__main__':
    main()
`;
    fs.writeFileSync(YT_SCRIPT, script);
}

const server = http.createServer((req, res) => {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    if (req.method === 'GET' && req.url === '/api/ping') {
        let hasCookie = false;
        let hasApiKey = false;
        if (fs.existsSync(CONFIG_FILE)) {
            try {
                const cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
                hasCookie = !!cfg.cookie;
                hasApiKey = !!cfg.api_key;
            } catch (e) {}
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, version: "2.0.0", hasCookie, hasApiKey }));
        return;
    }

    if (req.method === 'POST' && req.url === '/api/yt-download') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            ensureYTRunner();
            let parsed = {};
            try { parsed = JSON.parse(body); } catch(e) {}
            const proc = spawn('python3', [YT_SCRIPT, JSON.stringify(parsed)]);
            let stdout = '', stderr = '';
            proc.stdout.on('data', d => stdout += d.toString());
            proc.stderr.on('data', d => stderr += d.toString());
            proc.on('close', code => {
                const match = stdout.match(/\{[\s\S]*"success"[\s\S]*\}/);
                if (match) {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(match[0]);
                } else {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, error: stderr || stdout || 'Download failed' }));
                }
            });
        });
        return;
    }

    if (req.method === 'POST' && req.url === '/api/spoof') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            ensureSpoofRunner();
            let parsed = {};
            try { parsed = JSON.parse(body); } catch(e) {}
            const proc = spawn('python3', [SPOOF_SCRIPT, JSON.stringify(parsed)]);
            let stdout = '', stderr = '';
            proc.stdout.on('data', d => stdout += d.toString());
            proc.stderr.on('data', d => stderr += d.toString());
            proc.on('close', code => {
                const match = stdout.match(/\[[\s\S]*\]/);
                if (match) {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: true, results: JSON.parse(match[0]) }));
                } else {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, error: stderr || stdout || 'Spoofer error' }));
                }
            });
        });
        return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: "Endpoint not found" }));
});

server.listen(PORT, () => {
    console.log(`[Termux Bridge] Server listening on port ${PORT}`);
});
