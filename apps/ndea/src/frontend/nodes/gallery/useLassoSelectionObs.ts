/**
 * Gallery obs types + sizing constant.
 *
 * Shared by the gallery body (`GalleryPane`), the card (`LassoGalleryCard`), and
 * the node-scoped selection hook (`usePredicateGalleryObs`).
 *
 * The legacy global-lasso hook that once lived here (subscribing to
 * `selectionSyncStore` / `selectionBus`) was superseded by
 * `usePredicateGalleryObs`, which scopes the gallery to the node's wired
 * `host.inputSelection` — no global-bus read. Only the shared types + cap remain.
 */

export interface LassoObs {
  rowIndex: number;
  fov: string | null;
  t: number;
  x: number;
  y: number;
  /** Per-obs Z plane, when the dataset has a `z` spatial column. */
  z: number | undefined;
  /** Track id, when the dataset has a `track_id` column (shown on the card). */
  trackId: number | undefined;
  /** Dataset key in multi-dataset mode; undefined for single-dataset stores. */
  datasetKey: string | undefined;
}

export interface UseLassoSelectionObsResult {
  obs: LassoObs[];
  rowCount: number;
  isLoading: boolean;
  isError: boolean;
  /** Source kind currently broadcasting — "panel" (lasso) or "external" (collection). */
  sourceKind: "panel" | "external" | null;
}

/** Hard cap to keep first paint snappy. UI surfaces a "showing top N" hint when truncated. */
export const MAX_GALLERY_OBS = 5000;
