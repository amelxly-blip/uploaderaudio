import { jsonError } from "../_shared/auth.js";

const ASSET_ID_PATTERN = /^\d{1,20}$/;

export async function onRequestGet({ request }) {
  const assetId = new URL(request.url).searchParams.get("assetId") || "";
  if (!ASSET_ID_PATTERN.test(assetId)) {
    return jsonError("Asset ID gambar harus berupa angka.", 400);
  }

  const upstreamUrl = new URL("https://thumbnails.roblox.com/v1/assets");
  upstreamUrl.search = new URLSearchParams({
    assetIds: assetId,
    size: "420x420",
    format: "Png",
    isCircular: "false",
  }).toString();

  try {
    const upstream = await fetch(upstreamUrl, {
      headers: { Accept: "application/json" },
      redirect: "error",
    });
    if (!upstream.ok) {
      return jsonError(`Pratinjau gambar Roblox gagal dimuat (${upstream.status}).`, 502);
    }

    const data = await upstream.json();
    const imageUrl = data?.data?.[0]?.imageUrl;
    if (typeof imageUrl !== "string") {
      return jsonError("Roblox tidak menyediakan pratinjau untuk gambar ini.", 404);
    }

    const parsedUrl = new URL(imageUrl);
    if (parsedUrl.protocol !== "https:" || !parsedUrl.hostname.endsWith(".rbxcdn.com")) {
      return jsonError("Alamat pratinjau gambar Roblox tidak valid.", 502);
    }

    const imageResponse = await fetch(parsedUrl, {
      headers: { Accept: "image/png" },
      redirect: "error",
    });
    const contentType = imageResponse.headers.get("Content-Type")?.split(";")[0].toLowerCase();
    if (!imageResponse.ok || !/^image\/(?:png|jpeg|webp)$/.test(contentType || "")) {
      return jsonError("File pratinjau gambar Roblox tidak valid.", 502);
    }

    return new Response(imageResponse.body, {
      headers: {
        "Cache-Control": "public, max-age=300",
        "Content-Type": contentType,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("Roblox thumbnail lookup failed.", error);
    return jsonError("Pratinjau gambar Roblox sementara tidak bisa dimuat.", 502);
  }
}
