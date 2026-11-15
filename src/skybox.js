export const SKYBOX_FACES = [
  { key: "Ft", label: "Depan", property: "SkyboxFt" },
  { key: "Bk", label: "Belakang", property: "SkyboxBk" },
  { key: "Lf", label: "Kiri", property: "SkyboxLf" },
  { key: "Rt", label: "Kanan", property: "SkyboxRt" },
  { key: "Up", label: "Atas", property: "SkyboxUp" },
  { key: "Dn", label: "Bawah", property: "SkyboxDn" },
];

const MAX_SKYBOX_IMAGE_PIXELS = 32_000_000;
const MIN_SKYBOX_PANORAMA_FACE_SIZE = 128;
const SKYBOX_PI = Math.PI;

const SKYBOX_FACE_ORIENTATIONS = {
  Ft: "menghadap depan (-Z), kanan gambar ke +X dan atas gambar ke +Y",
  Bk: "menghadap belakang (+Z), kanan gambar ke -X dan atas gambar ke +Y",
  Lf: "menghadap kiri (-X), kanan gambar ke -Z dan atas gambar ke +Y",
  Rt: "menghadap kanan (+X), kanan gambar ke +Z dan atas gambar ke +Y",
  Up: "menghadap atas (+Y), kanan gambar ke -Z dan tepi atas mengarah ke kanan (+X)",
  Dn: "menghadap bawah (-Y), kanan gambar ke -Z dan tepi atas mengarah ke kiri (-X)",
};

export function getSkyboxAtlasCells(width, height) {
  if (
    !Number.isInteger(width)
    || !Number.isInteger(height)
    || width < 3
    || height < 2
    || width * 2 !== height * 3
    || width % 3 !== 0
    || height % 2 !== 0
  ) {
    throw new Error("Atlas harus berupa grid 3 kolom × 2 baris dengan enam kotak persegi yang sama besar.");
  }
  const size = width / 3;
  if (size >= 8000) {
    throw new Error("Setiap sisi atlas harus lebih kecil dari 8000 × 8000 piksel.");
  }
  if (width * height > MAX_SKYBOX_IMAGE_PIXELS) {
    throw new Error("Resolusi atlas terlalu besar untuk diproses dengan aman. Gunakan maksimal 32 megapiksel.");
  }

  return SKYBOX_FACES.map((face, index) => ({
    key: face.key,
    x: (index % 3) * size,
    y: Math.floor(index / 3) * size,
    width: size,
    height: size,
  }));
}

export function getSkyboxPanoramaFaceSize(width, height) {
  if (
    !Number.isInteger(width)
    || !Number.isInteger(height)
    || width < MIN_SKYBOX_PANORAMA_FACE_SIZE * 4
    || height < MIN_SKYBOX_PANORAMA_FACE_SIZE * 2
    || Math.abs(width - height * 2) > 1
  ) {
    throw new Error("Panorama harus berasio 2:1 dan minimal 512 × 256 piksel.");
  }
  if (width * height > MAX_SKYBOX_IMAGE_PIXELS) {
    throw new Error("Resolusi panorama terlalu besar untuk diproses dengan aman. Gunakan maksimal 32 megapiksel.");
  }

  const faceSize = Math.floor(Math.min(width / 4, height / 2));
  if (faceSize < MIN_SKYBOX_PANORAMA_FACE_SIZE) {
    throw new Error("Setiap sisi hasil panorama harus berukuran minimal 128 × 128 piksel.");
  }
  return faceSize;
}

export function isSkyboxPanoramaImage(width, height) {
  return Number.isInteger(width)
    && Number.isInteger(height)
    && width > 0
    && height > 0
    && width / height >= 1.75
    && width / height <= 2.25;
}

export function getSkyboxPanoramaRegion(width, height) {
  if (!isSkyboxPanoramaImage(width, height)) {
    throw new Error("Panorama harus memiliki rasio sekitar 2:1, termasuk hasil 16:9.");
  }
  if (Math.abs(width - height * 2) <= 1) return { x: 0, y: 0, width, height };

  if (width < height * 2) {
    const cropHeight = Math.floor(width / 2);
    return {
      x: 0,
      y: Math.floor((height - cropHeight) / 2),
      width,
      height: cropHeight,
    };
  }

  const cropWidth = Math.floor(height * 2);
  return {
    x: Math.floor((width - cropWidth) / 2),
    y: 0,
    width: cropWidth,
    height,
  };
}

export function projectEquirectangularFace(sourcePixels, width, height, faceKey, faceSize) {
  if (
    !ArrayBuffer.isView(sourcePixels)
    || sourcePixels instanceof DataView
    || !Number.isInteger(width)
    || !Number.isInteger(height)
    || sourcePixels.length !== width * height * 4
  ) {
    throw new Error("Data panorama tidak valid untuk diproyeksikan.");
  }
  if (!SKYBOX_FACES.some(({ key }) => key === faceKey)) {
    throw new Error("Sisi Skybox tidak dikenal.");
  }
  const maximumFaceSize = getSkyboxPanoramaFaceSize(width, height);
  if (!Number.isInteger(faceSize) || faceSize < MIN_SKYBOX_PANORAMA_FACE_SIZE || faceSize > maximumFaceSize) {
    throw new Error(`Ukuran sisi hasil panorama harus antara 128 dan ${maximumFaceSize} piksel.`);
  }

  const pixels = new Uint8ClampedArray(faceSize * faceSize * 4);
  for (let y = 0; y < faceSize; y += 1) {
    const vertical = 1 - 2 * (y + 0.5) / faceSize;
    for (let x = 0; x < faceSize; x += 1) {
      const horizontal = 2 * (x + 0.5) / faceSize - 1;
      let directionX;
      let directionY;
      let directionZ;

      switch (faceKey) {
        case "Ft":
          directionX = horizontal;
          directionY = vertical;
          directionZ = -1;
          break;
        case "Bk":
          directionX = -horizontal;
          directionY = vertical;
          directionZ = 1;
          break;
        case "Lf":
          directionX = -1;
          directionY = vertical;
          directionZ = -horizontal;
          break;
        case "Rt":
          directionX = 1;
          directionY = vertical;
          directionZ = horizontal;
          break;
        case "Up":
          directionX = vertical;
          directionY = 1;
          directionZ = -horizontal;
          break;
        default:
          directionX = -vertical;
          directionY = -1;
          directionZ = -horizontal;
          break;
      }

      const longitude = Math.atan2(directionX, -directionZ);
      const directionLength = Math.hypot(directionX, directionY, directionZ);
      const latitude = Math.asin(directionY / directionLength);
      const panoramaU = longitude / (2 * SKYBOX_PI) + 0.5;
      const panoramaV = 0.5 - latitude / SKYBOX_PI;
      const sourceX = ((panoramaU * width - 0.5) % width + width) % width;
      const sourceY = Math.max(0, Math.min(height - 1, panoramaV * height - 0.5));
      const x0 = Math.floor(sourceX);
      const x1 = (x0 + 1) % width;
      const y0 = Math.floor(sourceY);
      const y1 = Math.min(height - 1, y0 + 1);
      const fractionX = sourceX - x0;
      const fractionY = sourceY - y0;
      const sourceTopLeft = (y0 * width + x0) * 4;
      const sourceTopRight = (y0 * width + x1) * 4;
      const sourceBottomLeft = (y1 * width + x0) * 4;
      const sourceBottomRight = (y1 * width + x1) * 4;
      const destination = (y * faceSize + x) * 4;

      for (let channel = 0; channel < 4; channel += 1) {
        const top = sourcePixels[sourceTopLeft + channel] * (1 - fractionX)
          + sourcePixels[sourceTopRight + channel] * fractionX;
        const bottom = sourcePixels[sourceBottomLeft + channel] * (1 - fractionX)
          + sourcePixels[sourceBottomRight + channel] * fractionX;
        pixels[destination + channel] = top * (1 - fractionY) + bottom * fractionY;
      }
    }
  }
  return pixels;
}

export const SKYBOX_PROMPTS = [
  {
    id: "daylight",
    name: "Awan siang realistis",
    description: "Awan cumulus besar, matahari sore, dan kabut cakrawala.",
    theme: "langit siang realistis dengan awan cumulus besar, matahari sore hangat tepat di pusat arah depan, dan kabut lembut dekat cakrawala",
  },
  {
    id: "moonlit",
    name: "Bulan tengah malam",
    description: "Langit indigo, bulan terang, dan awan tipis.",
    theme: "langit malam indigo yang tenang, bulan purnama terang berada jauh di sisi depan saja, bintang kecil tersebar merata dan awan tipis berlapis",
  },
  {
    id: "sunset",
    name: "Senja berawan",
    description: "Cahaya jingga dan awan berlapis di cakrawala.",
    theme: "langit senja dengan cahaya jingga keemasan, gradasi merah muda dan ungu, awan lembut berlapis di cakrawala",
  },
  {
    id: "nebula",
    name: "Nebula kosmik",
    description: "Kabut kosmik biru-ungu dan bintang jauh.",
    theme: "angkasa biru tua dan ungu dengan nebula lembut, gugus bintang jauh, cahaya kosmik halus, tanpa planet besar",
  },
  {
    id: "aurora",
    name: "Aurora kutub",
    description: "Pita aurora hijau kebiruan di langit malam.",
    theme: "langit kutub malam biru gelap dengan pita aurora hijau dan teal yang lembut, bintang halus, awan tipis jauh",
  },
  {
    id: "heaven",
    name: "Awan surga",
    description: "Lautan awan putih dengan cahaya keemasan yang lembut.",
    theme: "lautan awan putih berlapis yang luas, cahaya keemasan lembut menembus celah awan, langit biru pucat, suasana damai dan agung tanpa bangunan atau sosok",
  },
  {
    id: "anime-sunset",
    name: "Anime senja",
    description: "Langit anime orisinal dengan gradasi merah muda dan jingga.",
    theme: "pemandangan langit bergaya ilustrasi anime orisinal, senja merah muda dan jingga, awan lembut dengan tepi bercahaya, sapuan warna bersih dan suasana nostalgia, tanpa karakter atau bangunan",
  },
  {
    id: "anime-night",
    name: "Kota anime malam",
    description: "Langit anime malam dengan bintang dan cahaya kota jauh.",
    theme: "langit malam bergaya ilustrasi anime orisinal, biru kobalt dan ungu, bintang terang dan cahaya kota kecil jauh di cakrawala, awan tipis, tanpa karakter atau teks",
  },
  {
    id: "sakura",
    name: "Sakura pastel",
    description: "Langit musim semi merah muda dengan kelopak beterbangan.",
    theme: "langit musim semi pastel merah muda dan biru muda, kelopak sakura kecil melayang lembut di udara, awan putih tipis, suasana cerah dan tenang, tanpa pohon atau karakter",
  },
  {
    id: "floating-islands",
    name: "Pulau langit fantasi",
    description: "Pulau terapung mungil di atas awan bercahaya.",
    theme: "langit fantasi biru muda dengan gugusan pulau terapung kecil yang tersebar jauh, awan putih besar, sinar matahari lembut, kedalaman luas dan palet konsisten, tanpa bangunan besar",
  },
  {
    id: "ocean-dusk",
    name: "Lautan senja",
    description: "Cakrawala laut biru dengan cahaya matahari terbenam.",
    theme: "cakrawala laut senja biru tua dan jingga keemasan, garis laut tenang di kejauhan, awan tipis memantulkan cahaya, suasana sinematik dan damai",
  },
  {
    id: "enchanted-forest",
    name: "Hutan ajaib",
    description: "Kabut hijau dan cahaya kunang-kunang di langit malam.",
    theme: "langit malam fantasi hijau zamrud dan biru gelap, kabut bercahaya tipis, titik kunang-kunang kecil dan bintang, suasana hutan ajaib tanpa menampilkan pohon atau tanah",
  },
  {
    id: "cyberpunk",
    name: "Cyberpunk neon",
    description: "Langit malam ungu dengan pantulan neon di awan.",
    theme: "langit malam cyberpunk orisinal berwarna ungu, magenta, dan cyan, awan gelap memantulkan cahaya neon dari kota yang jauh, suasana futuristis tanpa tulisan atau logo",
  },
  {
    id: "crystal-ice",
    name: "Dunia kristal es",
    description: "Langit biru es dengan serpihan kristal berkilau.",
    theme: "langit fantasi biru es dan putih perak, serpihan kristal kecil berkilau melayang, awan dingin lembut dan cahaya kutub, kesan lapang tanpa permukaan tanah",
  },
  {
    id: "golden-desert",
    name: "Gurun keemasan",
    description: "Langit gurun hangat dengan awan tipis dan matahari jauh.",
    theme: "langit gurun luas berwarna pasir keemasan, biru pucat menuju jingga hangat, awan tipis dan matahari jauh yang lembut, cakrawala bersih tanpa bangunan",
  },
  {
    id: "thunderstorm",
    name: "Badai dramatis",
    description: "Awan badai biru tua dengan kilat jauh yang halus.",
    theme: "langit badai dramatis biru baja dan ungu gelap, awan tebal berlapis, kilat tipis jauh di cakrawala, kontras sinematik tanpa hujan yang menutupi gambar",
  },
  {
    id: "candy-clouds",
    name: "Awan permen pastel",
    description: "Awan lembut dengan warna mint, peach, dan lavender.",
    theme: "langit fantasi pastel dengan awan lembut berwarna mint, peach, lavender, dan biru muda, cahaya merata, bentuk sederhana dan ceria tanpa objek atau teks",
  },
  {
    id: "autumn",
    name: "Musim gugur",
    description: "Langit tembaga dan amber dengan daun yang terbawa angin.",
    theme: "langit musim gugur berwarna tembaga, amber, dan biru kelabu, beberapa daun kecil terbawa angin di udara, awan tipis dan cahaya sore yang hangat",
  },
  {
    id: "mountain-dawn",
    name: "Fajar pegunungan",
    description: "Cahaya fajar di atas puncak gunung yang jauh.",
    theme: "langit fajar pegunungan dengan gradasi biru dingin ke merah muda dan emas, siluet puncak gunung sangat jauh di garis cakrawala, awan lembut yang berlanjut ke tepi",
  },
  {
    id: "starfall",
    name: "Hujan meteor",
    description: "Langit biru malam dengan meteor kecil melintas jauh.",
    theme: "angkasa malam biru safir dan ungu, bintang halus dengan beberapa meteor kecil melintas jauh, cahaya lembut dan komposisi luas, tanpa planet besar",
  },
];

export function normalizeSkyAssetId(value) {
  const input = String(value || "").trim();
  const patterns = [
    /^(\d{1,20})$/,
    /^rbxassetid:\/\/(\d{1,20})$/i,
    /^https?:\/\/(?:www\.)?roblox\.com\/(?:library|catalog|asset)\/(\d{1,20})(?:[/?#]|$)/i,
    /^https?:\/\/(?:www\.)?roblox\.com\/asset\/\?id=(\d{1,20})(?:&|$)/i,
  ];
  for (const pattern of patterns) {
    const match = input.match(pattern);
    if (match) return match[1];
  }
  return null;
}

function escapeXml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&apos;",
  })[character]);
}

export function buildSkyboxRbxmx(name, faceIds) {
  const normalizedIds = {};
  for (const face of SKYBOX_FACES) {
    const id = normalizeSkyAssetId(faceIds?.[face.key]);
    if (!id) throw new Error(`Isi Asset ID gambar sisi ${face.label} dengan angka yang valid.`);
    normalizedIds[face.key] = id;
  }

  const displayName = String(name || "").trim();
  if (!displayName || displayName.length > 50) {
    throw new Error("Nama Sky harus berisi 1 sampai 50 karakter.");
  }

  const properties = SKYBOX_FACES.map(({ key, property }) =>
    `      <Content name="${property}"><url>rbxassetid://${normalizedIds[key]}</url></Content>`
  ).join("\n");

  return `<?xml version="1.0" encoding="utf-8"?>
<roblox version="4">
  <Item class="Sky" referent="RBX0">
    <Properties>
      <bool name="Archivable">true</bool>
      <string name="Name">${escapeXml(displayName)}</string>
${properties}
    </Properties>
  </Item>
</roblox>
`;
}

export function buildSkyboxPrompt(presetId, faceKey) {
  const preset = SKYBOX_PROMPTS.find((entry) => entry.id === presetId);
  const face = SKYBOX_FACES.find((entry) => entry.key === faceKey);
  if (!preset || !face) throw new Error("Preset atau sisi Skybox tidak dikenal.");

  return [
    `Buat SATU tekstur persegi 1:1 untuk sisi ${face.label} (${face.key}) dari sebuah skybox Roblox seamless.`,
    `Tema seluruh lingkungan: ${preset.theme}.`,
    `Kamera berada di pusat lingkungan dengan proyeksi cubemap 90 derajat; arah sisi ini ${SKYBOX_FACE_ORIENTATIONS[face.key]}.`,
    "Gambar harus menjadi bagian dari satu langit 360 derajat yang sama, bukan poster atau pemandangan terpisah.",
    "Samakan warna, pencahayaan, tinggi cakrawala, skala awan, dan detail di tepi dengan sisi tetangga; hindari objek utama tepat di tepi.",
    "Sisi Atas dan Bawah hanya menampilkan langit atau awan dari arah atas dan bawah, tanpa garis cakrawala.",
    "Jangan tampilkan kubus, dinding, sudut ruangan, bingkai, panel, garis pemisah, teks, logo, atau karakter.",
    `Keluarkan hanya satu gambar untuk sisi ${face.key}; jangan tampilkan keenam sisi dalam satu lembar.`,
  ].join(" ");
}

export function buildSkyboxPanoramaPrompt(presetId) {
  const preset = SKYBOX_PROMPTS.find((entry) => entry.id === presetId);
  if (!preset) throw new Error("Preset Skybox tidak dikenal.");

  return [
    "Buat SATU gambar panorama langit 360 derajat untuk Skybox Roblox, dengan proyeksi equirectangular (longitude-latitude) dan rasio tepat 2:1.",
    `Suasana dan isi panorama: ${preset.theme}.`,
    "Letakkan arah depan dan objek utama di tengah horizontal gambar. Jika tema memiliki cakrawala, buat garisnya lurus tepat di tengah vertikal; jangan tambahkan cakrawala pada tema angkasa atau langit tanpa horizon.",
    "Tepi kiri dan kanan harus menyambung sempurna saat panorama diulang 360 derajat; samakan warna, awan, cahaya, dan bentuk pada kedua tepi.",
    "Bagian paling atas adalah arah tepat ke langit dan bagian paling bawah arah tepat ke bawah; jaga gradasi serta skala awan tetap lembut dan konsisten.",
    "Gunakan bentuk awan besar yang lembut dan gradasi halus. Hindari detail kecil, bintik, grain, vignette, flare, tanah, bangunan, burung, teks, dan watermark.",
    "Resolusi ideal 4096 × 2048 piksel atau rasio 2:1 tertinggi yang didukung.",
    "Keluarkan hanya satu panorama utuh, bukan atlas 3×2, kubus, cross, enam panel, kolase, atau gambar terpisah.",
  ].join(" ");
}
