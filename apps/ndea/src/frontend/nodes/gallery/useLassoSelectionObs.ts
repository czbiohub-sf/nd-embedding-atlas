/**
 * Gallery obs types + sizing constant.
 *
 * Shared by the gallery body (`GalleryPane`), the card (`LassoGalleryCard`), and
 * the node-scoped selection hook (`usePredicateGalleryObs`).
 *
 * The legacy process-wide lasso hook that once lived here was superseded by
 * `usePredicateGalleryObs`, which scopes the gallery to the node's wired
 * `host.inputPredicate` — no process-wide predicate read. Only shared types remain.
 */
import type { RowIndex } from "@ndea/sdk";

export interface LassoObs {
  rowIndex: RowIndex;
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
  /** Source kind currently providing rows to the gallery. */
  sourceKind: "input" | "external" | null;
}

/** Hard cap to keep first paint snappy. UI surfaces a "showing top N" hint when truncated. */
export const MAX_GALLERY_OBS = 5000;
