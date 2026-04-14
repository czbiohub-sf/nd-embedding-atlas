/**
 * Extract modality from a MuData obsm key like "rna:X_umap" -> "rna".
 * Returns undefined for plain keys like "X_umap".
 */
export function getModality(obsmKey: string): string | undefined {
  const idx = obsmKey.indexOf(":");
  return idx > 0 ? obsmKey.slice(0, idx) : undefined;
}

/**
 * Extract the bare obsm name from a MuData key: "rna:X_umap" -> "X_umap".
 * Returns the key unchanged for plain keys.
 */
export function getBareObsmKey(obsmKey: string): string {
  const idx = obsmKey.indexOf(":");
  return idx > 0 ? obsmKey.slice(idx + 1) : obsmKey;
}
