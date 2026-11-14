export function filterUploadHistory(uploads, { query = "", assetType = "all" } = {}) {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  return uploads.filter((upload) => {
    const matchesType = assetType === "all" || upload.asset_type === assetType;
    const matchesQuery = !normalizedQuery
      || String(upload.display_name || "").toLocaleLowerCase().includes(normalizedQuery)
      || String(upload.asset_id || "").toLocaleLowerCase().includes(normalizedQuery);
    return matchesType && matchesQuery;
  });
}
