/**
 * Which obs columns are scoreable features.
 *
 * Mirrors the intent of `feature_viewer/data.py`'s `META_BLACKLIST`: a feature is any numeric
 * column that is not an identifier, a label, a model output, or acquisition metadata. Getting
 * this wrong is quietly bad in both directions — offering `fov` as a feature invites someone
 * to score fields by their position on the plate, and dropping a real feature makes it
 * invisible rather than merely unused.
 *
 * Detected by name rather than by dtype because the metadata carries names only. Feature names
 * themselves are never hardcoded: the instanseg and cellpose matrices rename each other's
 * features, so the set has to come from the data.
 */

/** Identity, labels, outputs and acquisition metadata — everything that is not a measurement. */
const NOT_FEATURES = new Set([
  // plate / field identity
  "well",
  "well_row",
  "well_col",
  "fov",
  "fov_name",
  "filename",
  "timepoint",
  "t",
  "z",
  // human labels and model outputs
  "goodness",
  "goodness_user",
  "goodness_label",
  "predicted_goodness",
  "predicted_good_proba",
  "score",
  "fov_score",
  // synthetic crop coordinates and acquisition metadata
  "x",
  "y",
  "image_width_px",
  "image_height_px",
  "pixel_size_um",
]);

/**
 * Reduced-embedding outputs (`PCA1`, `TSNE2`, `UMAP3`, …) are results computed FROM features,
 * so scoring on them would be circular.
 */
const REDUCED = /^(pca|tsne|umap|phate|diffmap|scvi)\d*$/i;

/** Internal columns: ndea prefixes with `__`, and a leading `_` is conventionally private. */
const INTERNAL = /^_/;

/**
 * Feature columns, in the order the dataset presents them.
 *
 * `extraExcluded` covers per-dataset oddities without editing this list — e.g. a matrix that
 * carries a bookkeeping numeric nobody wants to score on.
 */
export function featureColumns(columns: readonly string[], extraExcluded: readonly string[] = []): string[] {
  const extra = new Set(extraExcluded);
  return columns.filter(
    (name) => !INTERNAL.test(name) && !NOT_FEATURES.has(name) && !REDUCED.test(name) && !extra.has(name),
  );
}

/** True when `name` would be offered as a feature. */
export function isFeatureColumn(name: string): boolean {
  return featureColumns([name]).length === 1;
}
