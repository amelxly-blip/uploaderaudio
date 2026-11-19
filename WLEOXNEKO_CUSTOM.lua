--[[
    IMPORTER HUB (Delta, ramah mobile)

    Fitur:
    - Import RBXM / RBXL / RBXLX / RBXMX dari folder Workspace Delta
    - Toolbox: cari & import Model, Decal, Mesh dari Creator Store
    - AI Chat: ngobrol dengan AI lewat OpenRouter (butuh API key)
    - Upload Gambar / Animasi / RBXM lewat Roblox Open Cloud (butuh API key)
    - Pengaturan: simpan API key & Creator ID

    Soal script di dalam file:
    Isi file tidak pernah dihapus, difilter, atau diubah. Semua Script,
    LocalScript, dan ModuleScript ikut masuk apa adanya. Setelah dipasang,
    jumlah script dibandingkan dengan sebelumnya dan ditampilkan di status bar.
]]

local Players = game:GetService("Players")
local UIS = game:GetService("UserInputService")
local HttpService = game:GetService("HttpService")
local lp = Players.LocalPlayer

local getAsset = getcustomasset or getsynasset
if not (getAsset and listfiles) then
    warn("Executor kamu belum support listfiles/getcustomasset")
    return
end
local adaFolder = isfolder or function() return false end
local httpReq = request or http_request or (syn and syn.request) or (http and http.request)

------------------------------------------------------------------
-- KONFIGURASI (disimpan lokal kalau tekan SIMPAN di Pengaturan)
------------------------------------------------------------------
local FILE_CONFIG = "importer_config.json"
local config = {
    ocKey = "",
    creatorId = "",
    creatorTipe = "User",
    orKey = "",
    orModel = "openai/gpt-4o-mini",
}

local function muatConfig()
    if isfile and readfile and isfile(FILE_CONFIG) then
        local ok, data = pcall(function()
            return HttpService:JSONDecode(readfile(FILE_CONFIG))
        end)
        if ok and type(data) == "table" then
            for k, v in pairs(data) do
                if config[k] ~= nil and type(v) == "string" then config[k] = v end
            end
        end
    end
end

local function simpanConfig()
    if not writefile then return false end
    return (pcall(function()
        writefile(FILE_CONFIG, HttpService:JSONEncode(config))
    end))
end

muatConfig()

------------------------------------------------------------------
-- DATA
------------------------------------------------------------------
local JENIS = {
    {kunci = "rbxm",  judul = "Import RBXM",  ket = "Model binary (.rbxm)", ikon = "M"},
    {kunci = "rbxl",  judul = "Import RBXL",  ket = "Place binary (.rbxl)", ikon = "L"},
    {kunci = "rbxlx", judul = "Import RBXLX", ket = "Place XML (.rbxlx)",   ikon = "LX"},
    {kunci = "rbxmx", judul = "Import RBXMX", ket = "Model XML (.rbxmx)",   ikon = "MX"},
}
local JENIS_KUNCI = {}
for _, j in ipairs(JENIS) do JENIS_KUNCI[j.kunci] = j end

local UPLOAD = {
    up_gambar = {judul = "Upload Gambar", ket = "png/jpg/bmp/tga jadi Decal",
        ext = {"png", "jpg", "jpeg", "bmp", "tga"}, tipe = "Decal"},
    up_animasi = {judul = "Upload Animasi", ket = "rbxm/rbxmx hasil export animasi",
        ext = {"rbxm", "rbxmx"}, tipe = "Animation"},
    up_model = {judul = "Upload RBXM", ket = "model .rbxm jadi Model",
        ext = {"rbxm"}, tipe = "Model"},
}

local CONTENT_TYPE = {
    png = "image/png", jpg = "image/jpeg", jpeg = "image/jpeg",
    bmp = "image/bmp", tga = "image/tga",
    rbxm = "model/x-rbxm", rbxmx = "model/x-rbxm",
}

local EXT_DICARI = {"rbxm", "rbxl", "rbxlx", "rbxmx", "png", "jpg", "jpeg", "bmp", "tga"}

local TUJUAN = {
    {nama = "Workspace", obj = workspace},
    {nama = "ReplicatedStorage", obj = game:GetService("ReplicatedStorage")},
}
local idxTujuan = 1

-- Untuk file place: isi service dipindah ke service yang sama di game
local SKIP_SERVICE = {Players = true, CoreGui = true, CorePackages = true}
local SKIP_ANAK = {Terrain = true, Camera = true}

local fileTersedia = {}
for _, e in ipairs(EXT_DICARI) do fileTersedia[e] = {} end

------------------------------------------------------------------
-- SCAN FILE
------------------------------------------------------------------
local function scanFolder(path, kedalaman)
    local ok, isi = pcall(listfiles, path)
    if not ok or type(isi) ~= "table" then return end
    for _, p in ipairs(isi) do
        local nama = p:match("[^/\\]+$") or p
        local okF, folder = pcall(adaFolder, p)
        if okF and folder then
            if kedalaman < 2 then scanFolder(p, kedalaman + 1) end
        else
            local ext = nama:lower():match("%.(%w+)$")
            if ext and fileTersedia[ext] then
                table.insert(fileTersedia[ext], {nama = nama, path = p, ext = ext})
            end
        end
    end
end

local function scanSemua()
    for _, e in ipairs(EXT_DICARI) do fileTersedia[e] = {} end
    scanFolder("", 0)
    local total = 0
    for _, e in ipairs(EXT_DICARI) do total = total + #fileTersedia[e] end
    if total == 0 then scanFolder(".", 0) end
    for _, e in ipairs(EXT_DICARI) do
        table.sort(fileTersedia[e], function(a, b)
            return a.nama:lower() < b.nama:lower()
        end)
    end
end

------------------------------------------------------------------
-- HELPER UMUM
------------------------------------------------------------------
local function muatObjek(f)
    local kandidat = {f.path, (f.path:gsub("^%./", "")), f.nama}
    local errTerakhir = "tidak diketahui"
    for _, p in ipairs(kandidat) do
        local ok, res = pcall(function()
            return game:GetObjects(getAsset(p))
        end)
        if ok and type(res) == "table" and #res > 0 then
            return res
        end
        errTerakhir = ok and "file kosong" or tostring(res)
    end
    return nil, errTerakhir
end

local function layananDari(obj)
    local ok, svc = pcall(game.GetService, game, obj.ClassName)
    if ok and svc and svc ~= obj then return svc end
    return nil
end

-- Hitung semua script (Script, LocalScript, ModuleScript) di satu objek
local function hitung(inst, t)
    local function cek(i)
        if i:IsA("LuaSourceContainer") then
            t[i.ClassName] = (t[i.ClassName] or 0) + 1
            t._total = (t._total or 0) + 1
        end
    end
    cek(inst)
    for _, d in ipairs(inst:GetDescendants()) do cek(d) end
end

local function taruhDiDepan(obj)
    local char = lp.Character
    local root = char and char:FindFirstChild("HumanoidRootPart")
    if root and obj:IsA("PVInstance") then
        pcall(function() obj:PivotTo(root.CFrame * CFrame.new(0, 0, -10)) end)
    end
end

local function decodeJson(res)
    if res and type(res.Body) == "string" then
        local ok, d = pcall(function() return HttpService:JSONDecode(res.Body) end)
        if ok and type(d) == "table" then return d end
    end
    return nil
end

local function trim(s)
    return (tostring(s or ""):gsub("^%s+", ""):gsub("%s+$", ""))
end

------------------------------------------------------------------
-- GUI DASAR
------------------------------------------------------------------
local C = {
    bg = Color3.fromRGB(24, 24, 28),
    panel = Color3.fromRGB(34, 34, 40),
    kartu = Color3.fromRGB(44, 44, 54),
    aktif = Color3.fromRGB(78, 78, 98),
    teks = Color3.fromRGB(235, 235, 240),
    redup = Color3.fromRGB(150, 150, 165),
    hijau = Color3.fromRGB(90, 220, 140),
    merah = Color3.fromRGB(255, 110, 110),
}

local function buat(class, props, parent)
    local o = Instance.new(class)
    for k, v in pairs(props) do o[k] = v end
    o.Parent = parent
    return o
end

local function sudut(o, r)
    buat("UICorner", {CornerRadius = UDim.new(0, r or 8)}, o)
    return o
end

local function label(props, parent)
    props.BackgroundTransparency = 1
    props.Font = props.Font or Enum.Font.Gotham
    props.TextColor3 = props.TextColor3 or C.teks
    props.TextSize = props.TextSize or 12
    props.TextXAlignment = props.TextXAlignment or Enum.TextXAlignment.Left
    return buat("TextLabel", props, parent)
end

local function tombol(props, parent)
    props.BorderSizePixel = 0
    props.Font = props.Font or Enum.Font.GothamBold
    props.TextColor3 = props.TextColor3 or C.teks
    props.TextSize = props.TextSize or 12
    return sudut(buat("TextButton", props, parent), 8)
end

local function kotakTeks(props, parent)
    props.BackgroundColor3 = C.panel
    props.BorderSizePixel = 0
    props.TextColor3 = C.teks
    props.PlaceholderColor3 = C.redup
    props.Font = Enum.Font.Gotham
    props.TextSize = 12
    props.TextXAlignment = Enum.TextXAlignment.Left
    props.ClearTextOnFocus = false
    local tb = sudut(buat("TextBox", props, parent), 8)
    buat("UIPadding", {PaddingLeft = UDim.new(0, 10), PaddingRight = UDim.new(0, 10)}, tb)
    return tb
end

local function pilihParent()
    if gethui then
        local ok, h = pcall(gethui)
        if ok and h then return h end
    end
    local ok = pcall(function() return game:GetService("CoreGui"):GetChildren() end)
    if ok then return game:GetService("CoreGui") end
    return lp:WaitForChild("PlayerGui")
end

local parentGui = pilihParent()
local lama = parentGui:FindFirstChild("ImporterHub")
if lama then lama:Destroy() end

local gui = buat("ScreenGui", {Name = "ImporterHub", ResetOnSpawn = false}, parentGui)

local LEBAR, TINGGI = 820, 520
local frame = sudut(buat("Frame", {
    Size = UDim2.new(0, LEBAR, 0, TINGGI),
    Position = UDim2.new(0.5, -LEBAR / 2, 0.5, -TINGGI / 2),
    BackgroundColor3 = C.bg,
    BorderSizePixel = 0,
    Active = true,
}, gui), 12)

-- Header
local header = buat("Frame", {Size = UDim2.new(1, 0, 0, 40), BackgroundTransparency = 1}, frame)
label({Text = "Importer Hub", Font = Enum.Font.GothamBold, TextSize = 16,
    Position = UDim2.new(0, 14, 0, 3), Size = UDim2.new(0, 220, 0, 20)}, header)
label({Text = "IMPORT · TOOLBOX · AI · UPLOAD", TextColor3 = C.redup, TextSize = 10,
    Position = UDim2.new(0, 14, 0, 23), Size = UDim2.new(0, 300, 0, 14)}, header)
local btnMin = tombol({Text = "-", Size = UDim2.new(0, 30, 0, 28),
    Position = UDim2.new(1, -72, 0, 6), BackgroundColor3 = C.kartu}, header)
local btnTutup = tombol({Text = "X", Size = UDim2.new(0, 30, 0, 28),
    Position = UDim2.new(1, -38, 0, 6), BackgroundColor3 = Color3.fromRGB(190, 60, 60)}, header)

local body = buat("Frame", {
    Size = UDim2.new(1, 0, 1, -40),
    Position = UDim2.new(0, 0, 0, 40),
    BackgroundTransparency = 1,
}, frame)

-- Status bar
local statusBar = sudut(buat("Frame", {
    Size = UDim2.new(1, -16, 0, 28),
    Position = UDim2.new(0, 8, 1, -36),
    BackgroundColor3 = C.panel,
    BorderSizePixel = 0,
}, body), 8)
local dot = sudut(buat("Frame", {
    Size = UDim2.new(0, 10, 0, 10),
    Position = UDim2.new(0, 10, 0.5, -5),
    BackgroundColor3 = C.hijau,
    BorderSizePixel = 0,
}, statusBar), 5)
local statusLabel = label({
    Text = "Siap",
    TextSize = 11,
    Position = UDim2.new(0, 28, 0, 0),
    Size = UDim2.new(1, -36, 1, 0),
    TextTruncate = Enum.TextTruncate.AtEnd,
}, statusBar)

local function setStatus(teks, merah)
    statusLabel.Text = teks
    dot.BackgroundColor3 = merah and C.merah or C.hijau
end

-- Sidebar & area isi
local sidebar = sudut(buat("Frame", {
    Size = UDim2.new(0, 140, 1, -44),
    Position = UDim2.new(0, 8, 0, 0),
    BackgroundColor3 = C.panel,
    BorderSizePixel = 0,
}, body), 10)
label({Text = lp.DisplayName, Font = Enum.Font.GothamBold, TextSize = 13,
    Position = UDim2.new(0, 12, 0, 6), Size = UDim2.new(1, -24, 0, 18),
    TextTruncate = Enum.TextTruncate.AtEnd}, sidebar)
label({Text = "@" .. lp.Name, TextColor3 = C.redup, TextSize = 10,
    Position = UDim2.new(0, 12, 0, 24), Size = UDim2.new(1, -24, 0, 14),
    TextTruncate = Enum.TextTruncate.AtEnd}, sidebar)

local isi = buat("Frame", {
    Size = UDim2.new(1, -164, 1, -44),
    Position = UDim2.new(0, 156, 0, 0),
    BackgroundTransparency = 1,
}, body)

local halaman = {}
local badgeMenu, badgeKartu, menuBtn = {}, {}, {}
local tombolTujuan = {}
local bukaHalaman, lakukanScan

local function perbaruiTujuan()
    for _, b in ipairs(tombolTujuan) do
        b.Text = "Tujuan: " .. TUJUAN[idxTujuan].nama
    end
end

local function gantiTujuan()
    idxTujuan = idxTujuan % #TUJUAN + 1
    perbaruiTujuan()
end

------------------------------------------------------------------
-- INTI: PASANG HASIL IMPORT (script tidak pernah dibuang)
------------------------------------------------------------------
local function pasangHasil(hasil, namaSumber)
    local tujuan = TUJUAN[idxTujuan]
    local sebelum, sesudah = {}, {}
    local ditaruh, gagal = {}, 0

    local function taruh(inst, induk)
        hitung(inst, sebelum)
        local ok = pcall(function() inst.Parent = induk end)
        if ok then
            table.insert(ditaruh, inst)
        else
            gagal = gagal + 1
        end
    end

    for _, obj in ipairs(hasil) do
        local svc = layananDari(obj)
        if svc then
            -- isi service (Workspace, ServerScriptService, dst) ke service yang sama
            if not SKIP_SERVICE[obj.ClassName] then
                for _, anak in ipairs(obj:GetChildren()) do
                    if not SKIP_ANAK[anak.ClassName] then
                        taruh(anak, svc)
                    end
                end
            end
        else
            taruh(obj, tujuan.obj)
        end
    end

    -- Model tunggal: taruh 10 stud di depan karakter
    if #hasil == 1 and #ditaruh == 1 and tujuan.obj == workspace then
        taruhDiDepan(ditaruh[1])
    end

    -- Cek ulang jumlah script setelah dipasang
    task.wait(0.2)
    for _, inst in ipairs(ditaruh) do
        if inst.Parent then hitung(inst, sesudah) end
    end

    local sb, sa = sebelum._total or 0, sesudah._total or 0
    local rinci = string.format("%d Script, %d LocalScript, %d ModuleScript",
        sesudah.Script or 0, sesudah.LocalScript or 0, sesudah.ModuleScript or 0)

    if gagal > 0 or sa < sb then
        setStatus(string.format("Peringatan: script %d dari %d, %d objek gagal dipasang", sa, sb, gagal), true)
        warn(string.format("[Importer] %s: script %d dari %d, gagal pasang %d objek", namaSumber, sa, sb, gagal))
        return false
    end

    setStatus(string.format("Berhasil %d objek | Script utuh: %d (%s)", #ditaruh, sa, rinci))
    print(string.format("[Importer] %s: %d objek, script utuh %d (%s)", namaSumber, #ditaruh, sa, rinci))
    return true
end

local function importFile(f)
    setStatus("Membaca " .. f.nama .. "...")
    local hasil, err = muatObjek(f)
    if not hasil then
        setStatus("Gagal membaca file: " .. tostring(err), true)
        return false
    end
    return pasangHasil(hasil, f.nama)
end

------------------------------------------------------------------
-- INTI: UPLOAD LEWAT ROBLOX OPEN CLOUD
------------------------------------------------------------------
local function buatMultipart(metaJson, namaFile, tipeKonten, isiFile)
    local batas = "----ImporterHub" .. tostring(math.random(100000, 999999)) .. tostring(os.time())
    local sep = "--" .. batas
    local aman = namaFile:gsub("[^%w%._%-]", "_")
    local bagian = {
        sep,
        'Content-Disposition: form-data; name="request"',
        "",
        metaJson,
        sep,
        'Content-Disposition: form-data; name="fileContent"; filename="' .. aman .. '"',
        "Content-Type: " .. tipeKonten,
        "",
        isiFile,
        sep .. "--",
        "",
    }
    return table.concat(bagian, "\r\n"), batas
end

local function unggahFile(f, jenis)
    if not httpReq then
        setStatus("Executor kamu tidak support request / http_request", true)
        return false
    end
    local idPembuat = trim(config.creatorId):match("^%d+$")
    if trim(config.ocKey) == "" or not idPembuat then
        setStatus("Isi Open Cloud API Key & Creator ID di menu Pengaturan dulu", true)
        return false
    end
    if not readfile then
        setStatus("Executor kamu tidak support readfile", true)
        return false
    end

    setStatus("Membaca " .. f.nama .. "...")
    local okR, isiFile = pcall(readfile, f.path)
    if not okR or type(isiFile) ~= "string" or #isiFile == 0 then
        setStatus("Gagal membaca file", true)
        return false
    end
    if #isiFile > 20 * 1024 * 1024 then
        setStatus("File lebih dari 20 MB, tidak bisa diunggah", true)
        return false
    end

    local tipeKonten = CONTENT_TYPE[f.ext]
    if not tipeKonten then
        setStatus("Format file tidak didukung: ." .. tostring(f.ext), true)
        return false
    end

    local nama = f.nama:gsub("%.[^%.]+$", "")
    nama = nama:sub(1, 50)

    local pembuat = {}
    if config.creatorTipe == "Group" then pembuat.groupId = idPembuat else pembuat.userId = idPembuat end

    local meta = HttpService:JSONEncode({
        assetType = jenis.tipe,
        displayName = nama,
        description = "Diunggah lewat Importer Hub",
        creationContext = {creator = pembuat},
    })
    local bodyReq, batas = buatMultipart(meta, f.nama, tipeKonten, isiFile)

    setStatus("Mengunggah " .. f.nama .. " sebagai " .. jenis.tipe .. "...")
    local okP, res = pcall(httpReq, {
        Url = "https://apis.roblox.com/assets/v1/assets",
        Method = "POST",
        Headers = {
            ["x-api-key"] = trim(config.ocKey),
            ["Content-Type"] = "multipart/form-data; boundary=" .. batas,
        },
        Body = bodyReq,
    })
    if not okP or not res then
        setStatus("Request gagal: " .. tostring(res), true)
        return false
    end

    local d = decodeJson(res)
    if not d or not d.path then
        local pesan = d and (d.message or d.error) or ("HTTP " .. tostring(res.StatusCode))
        setStatus("Upload ditolak (HTTP " .. tostring(res.StatusCode) .. "): " .. tostring(pesan), true)
        return false
    end

    -- Tunggu operasi selesai
    local hasilId
    for _ = 1, 40 do
        local dOp = d
        if not dOp.done then
            task.wait(1.5)
            local okQ, r2 = pcall(httpReq, {
                Url = "https://apis.roblox.com/assets/v1/" .. d.path,
                Method = "GET",
                Headers = {["x-api-key"] = trim(config.ocKey)},
            })
            dOp = okQ and decodeJson(r2) or nil
        end
        if dOp and dOp.done then
            if dOp.response and dOp.response.assetId then
                hasilId = tostring(dOp.response.assetId)
            else
                local pesan = dOp.error and dOp.error.message or "tidak diketahui"
                setStatus("Upload gagal: " .. tostring(pesan), true)
                return false
            end
            break
        end
    end

    if not hasilId then
        setStatus("Upload masih diproses, cek lagi nanti di Creator Hub", true)
        return false
    end

    if setclipboard then pcall(setclipboard, hasilId) end
    setStatus("Upload berhasil! Asset ID: " .. hasilId .. (setclipboard and " (disalin)" or ""))
    print("[Importer] Upload berhasil: " .. f.nama .. " -> asset ID " .. hasilId)
    return true
end

------------------------------------------------------------------
-- KOMPONEN: ITEM DAFTAR & PANEL DAFTAR FILE
------------------------------------------------------------------
local sedangKerja = false

local function buatItem(listFrame, urut, tagTeks, nama, sub, teksTombol, aksi)
    local item = sudut(buat("Frame", {
        Name = "Item", Size = UDim2.new(1, -8, 0, 44),
        BackgroundColor3 = C.kartu, BorderSizePixel = 0, LayoutOrder = urut,
    }, listFrame), 8)
    local tag = sudut(buat("Frame", {
        Size = UDim2.new(0, 52, 0, 26), Position = UDim2.new(0, 8, 0.5, -13),
        BackgroundColor3 = C.bg, BorderSizePixel = 0,
    }, item), 6)
    label({Text = tagTeks, Font = Enum.Font.GothamBold, TextSize = 10,
        Size = UDim2.new(1, 0, 1, 0), TextXAlignment = Enum.TextXAlignment.Center}, tag)
    label({Text = nama, Font = Enum.Font.GothamBold, TextSize = 12,
        Position = UDim2.new(0, 68, 0, sub and 4 or 0),
        Size = UDim2.new(1, -160, 0, sub and 20 or 44),
        TextTruncate = Enum.TextTruncate.AtEnd}, item)
    if sub then
        label({Text = sub, TextColor3 = C.redup, TextSize = 10,
            Position = UDim2.new(0, 68, 0, 24), Size = UDim2.new(1, -160, 0, 16),
            TextTruncate = Enum.TextTruncate.AtEnd}, item)
    end
    local btn = tombol({Text = teksTombol, TextSize = 11, Size = UDim2.new(0, 76, 0, 28),
        Position = UDim2.new(1, -84, 0.5, -14), BackgroundColor3 = C.aktif}, item)

    btn.Activated:Connect(function()
        if sedangKerja then return end
        sedangKerja = true
        btn.Text = "..."
        task.spawn(function()
            local ok, hasil = pcall(aksi)
            if not ok then
                setStatus("Error: " .. tostring(hasil), true)
                hasil = false
            end
            btn.Text = hasil and "DONE" or "ULANG"
            sedangKerja = false
        end)
    end)
    return item
end

local function buatItemToolbox(listFrame, urut, tagTeks, aset, sub, teksTombol, aksi)
    local item = sudut(buat("Frame", {
        Name = "Item",
        Size = UDim2.new(1, -8, 0, 108),
        BackgroundColor3 = C.kartu,
        BorderSizePixel = 0,
        LayoutOrder = urut,
    }, listFrame), 10)

    local thumbnail = buat("ImageLabel", {
        Size = UDim2.new(0, 92, 0, 92),
        Position = UDim2.new(0, 8, 0.5, -46),
        BackgroundColor3 = C.bg,
        BorderSizePixel = 0,
        Image = "rbxthumb://type=Asset&id=" .. aset.id .. "&w=420&h=420",
        ScaleType = Enum.ScaleType.Crop,
    }, item)
    sudut(thumbnail, 8)

    local tag = sudut(buat("Frame", {
        Size = UDim2.new(0, 58, 0, 24),
        Position = UDim2.new(0, 112, 0, 10),
        BackgroundColor3 = C.bg,
        BorderSizePixel = 0,
    }, item), 6)
    label({Text = tagTeks, Font = Enum.Font.GothamBold, TextSize = 10,
        Size = UDim2.new(1, 0, 1, 0), TextXAlignment = Enum.TextXAlignment.Center}, tag)

    label({Text = aset.nama, Font = Enum.Font.GothamBold, TextSize = 13,
        Position = UDim2.new(0, 112, 0, 38),
        Size = UDim2.new(1, -206, 0, 22),
        TextTruncate = Enum.TextTruncate.AtEnd}, item)
    label({Text = sub, TextColor3 = C.redup, TextSize = 11,
        Position = UDim2.new(0, 112, 0, 64),
        Size = UDim2.new(1, -206, 0, 18),
        TextTruncate = Enum.TextTruncate.AtEnd}, item)

    local btn = tombol({Text = teksTombol, TextSize = 11,
        Size = UDim2.new(0, 82, 0, 32),
        Position = UDim2.new(1, -90, 0.5, -16),
        BackgroundColor3 = C.aktif}, item)
    btn.Activated:Connect(function()
        if sedangKerja then return end
        sedangKerja = true
        btn.Text = "..."
        task.spawn(function()
            local ok, hasil = pcall(aksi)
            if not ok then
                setStatus("Error: " .. tostring(hasil), true)
                hasil = false
            end
            btn.Text = hasil and "DONE" or "ULANG"
            sedangKerja = false
        end)
    end)
    return item
end

local function pesanKosong(listFrame, teks)
    label({Name = "Item", Text = "  " .. teks, TextColor3 = C.redup, TextWrapped = true,
        Size = UDim2.new(1, -8, 0, 40), LayoutOrder = 1}, listFrame)
end

local function buatDaftarScroll(induk, posisi, ukuran)
    local list = sudut(buat("ScrollingFrame", {
        Size = ukuran,
        Position = posisi,
        BackgroundColor3 = C.panel,
        BorderSizePixel = 0,
        ScrollBarThickness = 4,
        CanvasSize = UDim2.new(0, 0, 0, 0),
        AutomaticCanvasSize = Enum.AutomaticSize.Y,
    }, induk), 8)
    buat("UIListLayout", {Padding = UDim.new(0, 4), SortOrder = Enum.SortOrder.LayoutOrder}, list)
    buat("UIPadding", {PaddingTop = UDim.new(0, 4), PaddingLeft = UDim.new(0, 4)}, list)
    return list
end

local function buatPanelDaftar(cfg)
    local p = {konteks = nil}
    p.frame = buat("Frame", {Size = UDim2.new(1, 0, 1, 0), BackgroundTransparency = 1, Visible = false}, isi)
    p.judul = label({Text = "", Font = Enum.Font.GothamBold, TextSize = 13,
        Size = UDim2.new(1, 0, 0, 22)}, p.frame)
    p.search = kotakTeks({
        Size = UDim2.new(1, -90, 0, 30), Position = UDim2.new(0, 0, 0, 26),
        Text = "", PlaceholderText = "Cari file...",
    }, p.frame)
    p.scan = tombol({Text = "SCAN", Size = UDim2.new(0, 82, 0, 30),
        Position = UDim2.new(1, -82, 0, 26), BackgroundColor3 = C.aktif}, p.frame)
    p.list = buatDaftarScroll(p.frame, UDim2.new(0, 0, 0, 62), UDim2.new(1, 0, 1, -100))
    p.kembali = tombol({Text = "< Kembali", Size = UDim2.new(0, 90, 0, 28),
        Position = UDim2.new(0, 0, 1, -28), BackgroundColor3 = C.kartu}, p.frame)
    p.extra = tombol({Text = "", Size = UDim2.new(0, 190, 0, 28),
        Position = UDim2.new(1, -190, 1, -28), BackgroundColor3 = C.kartu, TextSize = 11}, p.frame)

    function p.render()
        for _, c in ipairs(p.list:GetChildren()) do
            if c.Name == "Item" then c:Destroy() end
        end
        local konteks = p.konteks
        local q = p.search.Text:lower()
        local urut = 0
        for _, f in ipairs(cfg.ambil(konteks)) do
            if q == "" or f.nama:lower():find(q, 1, true) then
                urut = urut + 1
                buatItem(p.list, urut, string.upper(f.ext or ""), f.nama, nil, cfg.tombol,
                    function() return cfg.aksi(f, konteks) end)
            end
        end
        if urut == 0 then
            pesanKosong(p.list, "Belum ada file. Taruh file di folder Workspace Delta lalu tekan SCAN.")
        end
    end

    p.search:GetPropertyChangedSignal("Text"):Connect(p.render)
    p.scan.Activated:Connect(function() lakukanScan() end)
    p.kembali.Activated:Connect(function() bukaHalaman("dashboard") end)
    halaman[cfg.nama] = p.frame
    return p
end

------------------------------------------------------------------
-- HALAMAN: DASHBOARD
------------------------------------------------------------------
local halDash = buat("ScrollingFrame", {
    Size = UDim2.new(1, 0, 1, 0),
    BackgroundTransparency = 1,
    BorderSizePixel = 0,
    ScrollBarThickness = 4,
    CanvasSize = UDim2.new(0, 0, 0, 0),
    AutomaticCanvasSize = Enum.AutomaticSize.Y,
}, isi)
halaman.dashboard = halDash
buat("UIGridLayout", {
    CellSize = UDim2.new(0.5, -8, 0, 72),
    CellPadding = UDim2.new(0, 8, 0, 8),
    SortOrder = Enum.SortOrder.LayoutOrder,
}, halDash)

local KARTU = {
    {kunci = "toolbox", ikon = "TB", judul = "Toolbox", ket = "Cari & import Model, Mesh, Decal"},
    {kunci = "rbxm", ikon = "M", judul = "Import RBXM", ket = "Model binary (.rbxm)", badge = true},
    {kunci = "rbxl", ikon = "L", judul = "Import RBXL", ket = "Place binary (.rbxl)", badge = true},
    {kunci = "rbxlx", ikon = "LX", judul = "Import RBXLX", ket = "Place XML (.rbxlx)", badge = true},
    {kunci = "rbxmx", ikon = "MX", judul = "Import RBXMX", ket = "Model XML (.rbxmx)", badge = true},
    {kunci = "ai", ikon = "AI", judul = "AI Chat", ket = "Ngobrol dengan AI via OpenRouter"},
    {kunci = "up_gambar", ikon = "UG", judul = "Upload Gambar", ket = "Unggah gambar jadi Decal"},
    {kunci = "up_animasi", ikon = "UA", judul = "Upload Animasi", ket = "Unggah animasi (.rbxm/.rbxmx)"},
    {kunci = "up_model", ikon = "UM", judul = "Upload RBXM", ket = "Unggah model .rbxm"},
    {kunci = "setelan", ikon = "ST", judul = "Pengaturan", ket = "API key & Creator ID"},
}

for i, k in ipairs(KARTU) do
    local kartu = tombol({Text = "", BackgroundColor3 = C.kartu, LayoutOrder = i}, halDash)
    local ikon = sudut(buat("Frame", {
        Size = UDim2.new(0, 40, 0, 40), Position = UDim2.new(0, 10, 0.5, -20),
        BackgroundColor3 = C.aktif, BorderSizePixel = 0,
    }, kartu), 10)
    label({Text = k.ikon, Font = Enum.Font.GothamBold, TextSize = 14,
        Size = UDim2.new(1, 0, 1, 0), TextXAlignment = Enum.TextXAlignment.Center}, ikon)
    label({Text = k.judul, Font = Enum.Font.GothamBold, TextSize = 13,
        Position = UDim2.new(0, 58, 0, 10), Size = UDim2.new(1, -100, 0, 18),
        TextTruncate = Enum.TextTruncate.AtEnd}, kartu)
    label({Text = k.ket, TextColor3 = C.redup, TextSize = 10, TextWrapped = true,
        TextYAlignment = Enum.TextYAlignment.Top,
        Position = UDim2.new(0, 58, 0, 30), Size = UDim2.new(1, -64, 0, 32)}, kartu)
    if k.badge then
        badgeKartu[k.kunci] = label({Text = "0", TextColor3 = C.hijau, Font = Enum.Font.GothamBold,
            TextXAlignment = Enum.TextXAlignment.Right,
            Position = UDim2.new(1, -40, 0, 8), Size = UDim2.new(0, 32, 0, 16)}, kartu)
    end
    kartu.Activated:Connect(function() bukaHalaman(k.kunci) end)
end

------------------------------------------------------------------
-- HALAMAN: PANEL IMPORT & PANEL UPLOAD
------------------------------------------------------------------
local panelImport = buatPanelDaftar({
    nama = "_import",
    tombol = "ACTIVE",
    ambil = function(jenis)
        return jenis and fileTersedia[jenis.kunci] or {}
    end,
    aksi = function(f) return importFile(f) end,
})
table.insert(tombolTujuan, panelImport.extra)
panelImport.extra.Activated:Connect(gantiTujuan)

local panelUpload = buatPanelDaftar({
    nama = "_upload",
    tombol = "UPLOAD",
    ambil = function(jenis)
        local hasil = {}
        if jenis then
            for _, e in ipairs(jenis.ext) do
                for _, f in ipairs(fileTersedia[e] or {}) do table.insert(hasil, f) end
            end
            table.sort(hasil, function(a, b) return a.nama:lower() < b.nama:lower() end)
        end
        return hasil
    end,
    aksi = function(f, jenis) return unggahFile(f, jenis) end,
})
panelUpload.extra.Text = "Atur API Key >"
panelUpload.extra.Activated:Connect(function() bukaHalaman("setelan") end)

------------------------------------------------------------------
-- HALAMAN: TOOLBOX (Creator Store)
------------------------------------------------------------------
local halToolbox = buat("Frame", {Size = UDim2.new(1, 0, 1, 0), BackgroundTransparency = 1, Visible = false}, isi)
halaman.toolbox = halToolbox

local KAT = {
    {kunci = "Model", teks = "Model", tag = "MODEL"},
    {kunci = "Decal", teks = "Decal", tag = "DECAL"},
    {kunci = "MeshPart", teks = "Mesh", tag = "MESH"},
}
local katAktif = "Model"
local tombolKat = {}

local barisKat = buat("Frame", {Size = UDim2.new(1, 0, 0, 28), BackgroundTransparency = 1}, halToolbox)
buat("UIListLayout", {FillDirection = Enum.FillDirection.Horizontal, Padding = UDim.new(0, 4),
    SortOrder = Enum.SortOrder.LayoutOrder}, barisKat)

local function sorotKat()
    for k, b in pairs(tombolKat) do
        b.BackgroundColor3 = (k == katAktif) and C.aktif or C.kartu
    end
end

for i, k in ipairs(KAT) do
    local b = tombol({Text = k.teks, Size = UDim2.new(1 / #KAT, -3, 1, 0), LayoutOrder = i,
        BackgroundColor3 = C.kartu}, barisKat)
    tombolKat[k.kunci] = b
    b.Activated:Connect(function()
        katAktif = k.kunci
        sorotKat()
    end)
end
sorotKat()

local tbInput = kotakTeks({
    Size = UDim2.new(1, -90, 0, 30), Position = UDim2.new(0, 0, 0, 34),
    Text = "", PlaceholderText = "Kata kunci, contoh: sword",
}, halToolbox)
local tbCari = tombol({Text = "CARI", Size = UDim2.new(0, 82, 0, 30),
    Position = UDim2.new(1, -82, 0, 34), BackgroundColor3 = C.aktif}, halToolbox)
local tbList = buatDaftarScroll(halToolbox, UDim2.new(0, 0, 0, 70), UDim2.new(1, 0, 1, -104))
local tbInfo = label({Text = "", TextColor3 = C.redup, TextSize = 11,
    Position = UDim2.new(0, 0, 1, -28), Size = UDim2.new(1, -200, 0, 28)}, halToolbox)
local tbTujuan = tombol({Text = "", Size = UDim2.new(0, 190, 0, 28),
    Position = UDim2.new(1, -190, 1, -28), BackgroundColor3 = C.kartu, TextSize = 11}, halToolbox)
table.insert(tombolTujuan, tbTujuan)
tbTujuan.Activated:Connect(gantiTujuan)

local function cariCreatorStore(kat, q)
    local okP, res = pcall(httpReq, {
        Url = "https://apis.roblox.com/toolbox-service/v2/assets:search",
        Method = "POST",
        Headers = {["Content-Type"] = "application/json"},
        Body = HttpService:JSONEncode({searchCategoryType = kat, query = q}),
    })
    local d = okP and decodeJson(res) or nil
    if not (d and type(d.creatorStoreAssets) == "table") then
        local okG, res2 = pcall(httpReq, {
            Url = "https://apis.roblox.com/toolbox-service/v2/assets:search?searchCategoryType="
                .. kat .. "&query=" .. HttpService:UrlEncode(q),
            Method = "GET",
        })
        d = okG and decodeJson(res2) or nil
        res = okG and res2 or res
    end
    if not (d and type(d.creatorStoreAssets) == "table") then
        local pesan = d and (d.message or d.error)
        return nil, pesan and tostring(pesan) or ("HTTP " .. tostring(res and res.StatusCode or "?"))
    end
    local hasil = {}
    for _, it in ipairs(d.creatorStoreAssets) do
        local a = it.asset or it
        if a and a.id then
            table.insert(hasil, {
                id = tostring(a.id),
                nama = tostring(a.name or "?"),
                pembuat = it.creator and tostring(it.creator.name or "?") or "?",
            })
        end
    end
    return hasil
end

local function masukkanAsetToolbox(kat, it)
    local tujuan = TUJUAN[idxTujuan].obj
    setStatus("Memuat " .. it.nama .. "...")

    if kat == "Decal" then
        local tex = "rbxassetid://" .. it.id
        local ok, objs = pcall(function() return game:GetObjects(tex) end)
        if ok and type(objs) == "table" and objs[1] and objs[1]:IsA("Decal") then
            tex = objs[1].Texture
        end
        local part = Instance.new("Part")
        part.Name = it.nama:sub(1, 40)
        part.Anchored = true
        part.Size = Vector3.new(6, 6, 0.2)
        local d = Instance.new("Decal")
        d.Face = Enum.NormalId.Front
        d.Texture = tex
        d.Parent = part
        part.Parent = tujuan
        if tujuan == workspace then taruhDiDepan(part) end
        setStatus("Decal dipasang: " .. it.nama)
        return true
    end

    local ok, objs = pcall(function() return game:GetObjects("rbxassetid://" .. it.id) end)
    if ok and type(objs) == "table" and #objs > 0 then
        return pasangHasil(objs, it.nama)
    end

    if kat == "MeshPart" then
        local part = Instance.new("Part")
        part.Name = it.nama:sub(1, 40)
        part.Anchored = true
        part.Size = Vector3.new(4, 4, 4)
        local m = Instance.new("SpecialMesh")
        m.MeshType = Enum.MeshType.FileMesh
        m.MeshId = "rbxassetid://" .. it.id
        m.Parent = part
        part.Parent = tujuan
        if tujuan == workspace then taruhDiDepan(part) end
        setStatus("Mesh dipasang: " .. it.nama)
        return true
    end

    setStatus("Gagal memuat asset: " .. tostring(objs), true)
    return false
end

local function cariToolbox()
    local q = trim(tbInput.Text)
    if q == "" then
        setStatus("Ketik kata kunci dulu", true)
        return
    end
    if not httpReq then
        setStatus("Executor kamu tidak support request / http_request", true)
        return
    end
    local kat = katAktif
    local tagKat
    for _, k in ipairs(KAT) do if k.kunci == kat then tagKat = k.tag end end
    setStatus("Mencari " .. kat .. ": " .. q .. "...")
    tbInfo.Text = "Mencari..."

    task.spawn(function()
        local hasil, err = cariCreatorStore(kat, q)
        for _, c in ipairs(tbList:GetChildren()) do
            if c.Name == "Item" then c:Destroy() end
        end
        if not hasil then
            setStatus("Pencarian gagal: " .. tostring(err), true)
            tbInfo.Text = "Gagal"
            pesanKosong(tbList, "Pencarian gagal. Coba lagi.")
            return
        end
        if #hasil == 0 then
            tbInfo.Text = "0 hasil"
            setStatus("Tidak ada hasil untuk: " .. q, true)
            pesanKosong(tbList, "Tidak ada hasil.")
            return
        end
        for i, it in ipairs(hasil) do
            buatItemToolbox(tbList, i, tagKat, it, "oleh " .. it.pembuat .. " · ID " .. it.id, "IMPORT",
                function() return masukkanAsetToolbox(kat, it) end)
        end
        tbInfo.Text = #hasil .. " hasil"
        setStatus(#hasil .. " hasil " .. kat .. " untuk: " .. q)
    end)
end

tbCari.Activated:Connect(cariToolbox)
tbInput.FocusLost:Connect(function(enter) if enter then cariToolbox() end end)

------------------------------------------------------------------
-- HALAMAN: AI CHAT (OpenRouter)
------------------------------------------------------------------
local halAI = buat("Frame", {Size = UDim2.new(1, 0, 1, 0), BackgroundTransparency = 1, Visible = false}, isi)
halaman.ai = halAI

local aiList = sudut(buat("ScrollingFrame", {
    Size = UDim2.new(1, 0, 1, -38),
    BackgroundColor3 = C.panel,
    BorderSizePixel = 0,
    ScrollBarThickness = 4,
    CanvasSize = UDim2.new(0, 0, 0, 0),
    AutomaticCanvasSize = Enum.AutomaticSize.Y,
}, halAI), 8)
buat("UIListLayout", {Padding = UDim.new(0, 6), SortOrder = Enum.SortOrder.LayoutOrder}, aiList)
buat("UIPadding", {PaddingTop = UDim.new(0, 6), PaddingLeft = UDim.new(0, 6)}, aiList)

local aiInput = kotakTeks({
    Size = UDim2.new(1, -160, 0, 30), Position = UDim2.new(0, 0, 1, -30),
    Text = "", PlaceholderText = "Tulis pesan...",
}, halAI)
local aiKirim = tombol({Text = "KIRIM", Size = UDim2.new(0, 74, 0, 30),
    Position = UDim2.new(1, -154, 1, -30), BackgroundColor3 = C.aktif}, halAI)
local aiReset = tombol({Text = "RESET", Size = UDim2.new(0, 76, 0, 30),
    Position = UDim2.new(1, -76, 1, -30), BackgroundColor3 = C.kartu}, halAI)

local riwayat = {}
local urutPesan = 0
local aiSibuk = false
local AWALAN = {user = "Kamu: ", ai = "AI: ", sistem = ""}

local function tambahPesan(peran, teks)
    urutPesan = urutPesan + 1
    local warna = peran == "user" and C.aktif or (peran == "ai" and C.kartu or Color3.fromRGB(80, 56, 56))
    local lbl = sudut(buat("TextLabel", {
        Size = UDim2.new(1, -14, 0, 0),
        AutomaticSize = Enum.AutomaticSize.Y,
        BackgroundColor3 = warna,
        BorderSizePixel = 0,
        Text = AWALAN[peran] .. teks,
        TextColor3 = C.teks,
        Font = Enum.Font.Gotham,
        TextSize = 12,
        TextWrapped = true,
        TextXAlignment = Enum.TextXAlignment.Left,
        TextYAlignment = Enum.TextYAlignment.Top,
        LayoutOrder = urutPesan,
    }, aiList), 8)
    buat("UIPadding", {PaddingTop = UDim.new(0, 6), PaddingBottom = UDim.new(0, 6),
        PaddingLeft = UDim.new(0, 8), PaddingRight = UDim.new(0, 8)}, lbl)
    task.defer(function()
        task.wait()
        aiList.CanvasPosition = Vector2.new(0, 99999)
    end)
    return lbl
end

local function pesanUntukAPI()
    local hasil = {{role = "system",
        content = "Kamu asisten yang membantu soal Roblox, Luau, dan scripting. Jawab singkat dan jelas dalam bahasa Indonesia."}}
    local mulai = math.max(1, #riwayat - 19)
    for i = mulai, #riwayat do table.insert(hasil, riwayat[i]) end
    return hasil
end

local function kirimAI()
    local teks = trim(aiInput.Text)
    if teks == "" or aiSibuk then return end
    if trim(config.orKey) == "" then
        tambahPesan("sistem", "Isi OpenRouter API Key di menu Pengaturan dulu.")
        return
    end
    if not httpReq then
        tambahPesan("sistem", "Executor kamu tidak support request / http_request.")
        return
    end

    aiSibuk = true
    aiInput.Text = ""
    tambahPesan("user", teks)
    table.insert(riwayat, {role = "user", content = teks})
    local tunggu = tambahPesan("ai", "...")

    task.spawn(function()
        local ok, res = pcall(httpReq, {
            Url = "https://openrouter.ai/api/v1/chat/completions",
            Method = "POST",
            Headers = {
                ["Content-Type"] = "application/json",
                ["Authorization"] = "Bearer " .. trim(config.orKey),
            },
            Body = HttpService:JSONEncode({model = trim(config.orModel), messages = pesanUntukAPI()}),
        })

        local jawaban, galat
        if ok and res then
            local d = decodeJson(res)
            if d and d.choices and d.choices[1] and d.choices[1].message then
                jawaban = tostring(d.choices[1].message.content or "")
            elseif d and d.error then
                galat = type(d.error) == "table" and tostring(d.error.message) or tostring(d.error)
            else
                galat = "Respons tidak valid (HTTP " .. tostring(res.StatusCode) .. ")"
            end
        else
            galat = tostring(res)
        end

        if jawaban then
            tunggu.Text = AWALAN.ai .. jawaban
            table.insert(riwayat, {role = "assistant", content = jawaban})
        else
            tunggu.Text = "Gagal: " .. tostring(galat)
            tunggu.BackgroundColor3 = Color3.fromRGB(80, 56, 56)
            table.remove(riwayat)
        end
        aiSibuk = false
    end)
end

aiKirim.Activated:Connect(kirimAI)
aiInput.FocusLost:Connect(function(enter) if enter then kirimAI() end end)
aiReset.Activated:Connect(function()
    riwayat = {}
    for _, c in ipairs(aiList:GetChildren()) do
        if c:IsA("TextLabel") then c:Destroy() end
    end
    tambahPesan("sistem", "Percakapan direset.")
end)
tambahPesan("sistem", "Halo! Tanya apa saja soal Roblox/Luau. Isi API key OpenRouter di Pengaturan dulu.")

------------------------------------------------------------------
-- HALAMAN: PENGATURAN
------------------------------------------------------------------
local halSetelan = buat("ScrollingFrame", {
    Size = UDim2.new(1, 0, 1, 0),
    BackgroundTransparency = 1,
    BorderSizePixel = 0,
    ScrollBarThickness = 4,
    CanvasSize = UDim2.new(0, 0, 0, 0),
    AutomaticCanvasSize = Enum.AutomaticSize.Y,
    Visible = false,
}, isi)
halaman.setelan = halSetelan
buat("UIListLayout", {Padding = UDim.new(0, 6), SortOrder = Enum.SortOrder.LayoutOrder}, halSetelan)

local function buatField(urut, judul, nilai, ph)
    local baris = buat("Frame", {Size = UDim2.new(1, -8, 0, 48), BackgroundTransparency = 1,
        LayoutOrder = urut}, halSetelan)
    label({Text = judul, TextColor3 = C.redup, TextSize = 10, Size = UDim2.new(1, 0, 0, 14)}, baris)
    return kotakTeks({Size = UDim2.new(1, 0, 0, 28), Position = UDim2.new(0, 0, 0, 16),
        Text = nilai, PlaceholderText = ph}, baris)
end

label({Text = "Pengaturan  ·  API key & Creator ID", Font = Enum.Font.GothamBold, TextSize = 13,
    Size = UDim2.new(1, -8, 0, 20), LayoutOrder = 1}, halSetelan)
local fOcKey = buatField(2, "OPEN CLOUD API KEY (untuk Upload, izin Assets)", config.ocKey, "Tempel API key Open Cloud")
local fCreator = buatField(3, "CREATOR ID (User ID atau Group ID)", config.creatorId, "Contoh: 123456789")
local btnTipe = tombol({Text = "Tipe pembuat: " .. config.creatorTipe, Size = UDim2.new(1, -8, 0, 30),
    BackgroundColor3 = C.kartu, LayoutOrder = 4}, halSetelan)
local fOrKey = buatField(5, "OPENROUTER API KEY (untuk AI Chat)", config.orKey, "Tempel API key OpenRouter")
local fOrModel = buatField(6, "MODEL OPENROUTER", config.orModel, "Contoh: openai/gpt-4o-mini")
local btnSimpan = tombol({Text = "SIMPAN KE FILE", Size = UDim2.new(1, -8, 0, 32),
    BackgroundColor3 = C.aktif, LayoutOrder = 7}, halSetelan)
label({Text = "API key disimpan sebagai teks biasa di importer_config.json (folder Workspace Delta). " ..
    "Kalau tidak mau tersimpan, isi saja dan jangan tekan SIMPAN: nilai berlaku sampai GUI ditutup.",
    TextColor3 = C.redup, TextSize = 10, TextWrapped = true, TextYAlignment = Enum.TextYAlignment.Top,
    Size = UDim2.new(1, -8, 0, 44), LayoutOrder = 8}, halSetelan)

local function bacaSetelan()
    config.ocKey = trim(fOcKey.Text)
    config.creatorId = trim(fCreator.Text)
    config.orKey = trim(fOrKey.Text)
    config.orModel = trim(fOrModel.Text)
    if config.orModel == "" then config.orModel = "openai/gpt-4o-mini" end
end

for _, tb in ipairs({fOcKey, fCreator, fOrKey, fOrModel}) do
    tb.FocusLost:Connect(bacaSetelan)
end
btnTipe.Activated:Connect(function()
    config.creatorTipe = config.creatorTipe == "User" and "Group" or "User"
    btnTipe.Text = "Tipe pembuat: " .. config.creatorTipe
end)
btnSimpan.Activated:Connect(function()
    bacaSetelan()
    if simpanConfig() then
        setStatus("Pengaturan disimpan ke " .. FILE_CONFIG)
    else
        setStatus("Gagal menyimpan (executor tidak support writefile)", true)
    end
end)

------------------------------------------------------------------
-- MENU SIDEBAR
------------------------------------------------------------------
local sideScroll = buat("ScrollingFrame", {
    Size = UDim2.new(1, -8, 1, -48),
    Position = UDim2.new(0, 4, 0, 44),
    BackgroundTransparency = 1,
    BorderSizePixel = 0,
    ScrollBarThickness = 3,
    CanvasSize = UDim2.new(0, 0, 0, 0),
    AutomaticCanvasSize = Enum.AutomaticSize.Y,
}, sidebar)
buat("UIListLayout", {Padding = UDim.new(0, 4), SortOrder = Enum.SortOrder.LayoutOrder}, sideScroll)

local MENU = {
    {seksi = "MENU"},
    {kunci = "dashboard", nama = "Dashboard"},
    {kunci = "toolbox", nama = "Toolbox"},
    {kunci = "ai", nama = "AI Chat"},
    {seksi = "IMPORT"},
    {kunci = "rbxm", nama = "RBXM", badge = true},
    {kunci = "rbxl", nama = "RBXL", badge = true},
    {kunci = "rbxlx", nama = "RBXLX", badge = true},
    {kunci = "rbxmx", nama = "RBXMX", badge = true},
    {seksi = "GENERAL"},
    {kunci = "up_gambar", nama = "Upload Gambar"},
    {kunci = "up_animasi", nama = "Upload Animasi"},
    {kunci = "up_model", nama = "Upload RBXM"},
    {kunci = "setelan", nama = "Pengaturan"},
}

for i, m in ipairs(MENU) do
    if m.seksi then
        label({Text = "  " .. m.seksi, TextColor3 = C.redup, Font = Enum.Font.GothamBold, TextSize = 10,
            Size = UDim2.new(1, 0, 0, 16), LayoutOrder = i}, sideScroll)
    else
        local b = tombol({
            Text = "  " .. m.nama,
            Font = Enum.Font.Gotham,
            TextXAlignment = Enum.TextXAlignment.Left,
            Size = UDim2.new(1, -4, 0, 28),
            BackgroundColor3 = C.kartu,
            LayoutOrder = i,
        }, sideScroll)
        menuBtn[m.kunci] = b
        if m.badge then
            badgeMenu[m.kunci] = label({
                Text = "0", TextColor3 = C.redup, TextXAlignment = Enum.TextXAlignment.Right,
                Position = UDim2.new(1, -40, 0, 0), Size = UDim2.new(0, 32, 1, 0),
            }, b)
        end
        b.Activated:Connect(function() bukaHalaman(m.kunci) end)
    end
end

local function sorotMenu(kunci)
    for k, b in pairs(menuBtn) do
        b.BackgroundColor3 = (k == kunci) and C.aktif or C.kartu
    end
end

------------------------------------------------------------------
-- NAVIGASI & SCAN
------------------------------------------------------------------
local function perbaruiHitungan()
    for _, j in ipairs(JENIS) do
        local n = tostring(#fileTersedia[j.kunci])
        if badgeKartu[j.kunci] then badgeKartu[j.kunci].Text = n end
        if badgeMenu[j.kunci] then badgeMenu[j.kunci].Text = n end
    end
end

bukaHalaman = function(kunci)
    for _, f in pairs(halaman) do f.Visible = false end

    if JENIS_KUNCI[kunci] then
        local j = JENIS_KUNCI[kunci]
        panelImport.konteks = j
        panelImport.judul.Text = j.judul .. "  ·  " .. j.ket
        panelImport.search.PlaceholderText = "Cari file " .. kunci .. "..."
        panelImport.search.Text = ""
        panelImport.render()
        panelImport.frame.Visible = true
    elseif UPLOAD[kunci] then
        local u = UPLOAD[kunci]
        panelUpload.konteks = u
        panelUpload.judul.Text = u.judul .. "  ·  " .. u.ket
        panelUpload.search.PlaceholderText = "Cari file..."
        panelUpload.search.Text = ""
        panelUpload.render()
        panelUpload.frame.Visible = true
    elseif halaman[kunci] then
        halaman[kunci].Visible = true
    end
    sorotMenu(kunci)
end

lakukanScan = function()
    scanSemua()
    perbaruiHitungan()
    if panelImport.frame.Visible then panelImport.render() end
    if panelUpload.frame.Visible then panelUpload.render() end
    local total = 0
    for _, e in ipairs(EXT_DICARI) do total = total + #fileTersedia[e] end
    if total == 0 then
        setStatus("SCAN selesai: tidak ada file yang cocok di folder Workspace", true)
    else
        setStatus("SCAN selesai: " .. total .. " file ditemukan")
    end
end

perbaruiTujuan()

------------------------------------------------------------------
-- EVENT: TUTUP, KECILKAN, GESER
------------------------------------------------------------------
local koneksiGeser

local lamaToggle = parentGui:FindFirstChild("ImporterHubToggle")
if lamaToggle then lamaToggle:Destroy() end
local toggleGui = buat("ScreenGui", {
    Name = "ImporterHubToggle",
    ResetOnSpawn = false,
    Enabled = false,
}, parentGui)
local toggler = sudut(buat("ImageButton", {
    Name = "HubToggle",
    Size = UDim2.new(0, 64, 0, 64),
    Position = UDim2.new(0, 18, 0.5, -32),
    Image = "rbxassetid://75105787796422",
    BackgroundTransparency = 1,
    BorderSizePixel = 0,
    Active = true,
}, toggleGui), 14)
toggler.Activated:Connect(function()
    toggleGui.Enabled = false
    gui.Enabled = true
end)

btnTutup.Activated:Connect(function()
    gui.Enabled = false
    if toggleGui then toggleGui.Enabled = true end
end)

local kecil = false
btnMin.Activated:Connect(function()
    kecil = not kecil
    body.Visible = not kecil
    frame.Size = UDim2.new(0, LEBAR, 0, kecil and 40 or TINGGI)
end)

local dragging, dragStart, startPos
header.InputBegan:Connect(function(input)
    if input.UserInputType == Enum.UserInputType.MouseButton1
        or input.UserInputType == Enum.UserInputType.Touch then
        dragging = true
        dragStart = input.Position
        startPos = frame.Position
        input.Changed:Connect(function()
            if input.UserInputState == Enum.UserInputState.End then dragging = false end
        end)
    end
end)
koneksiGeser = UIS.InputChanged:Connect(function(input)
    if dragging and (input.UserInputType == Enum.UserInputType.MouseMovement
        or input.UserInputType == Enum.UserInputType.Touch) then
        local d = input.Position - dragStart
        frame.Position = UDim2.new(startPos.X.Scale, startPos.X.Offset + d.X,
            startPos.Y.Scale, startPos.Y.Offset + d.Y)
    end
end)

------------------------------------------------------------------
-- MULAI
------------------------------------------------------------------
lakukanScan()
bukaHalaman("dashboard")
