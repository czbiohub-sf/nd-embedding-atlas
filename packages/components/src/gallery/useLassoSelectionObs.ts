/**
 * Gallery obs types + sizing constant.
 *
 * Shared by the gallery body (`GalleryPane`), the card (`LassoGalleryCard`), and
 * the element-scoped selection hook (`usePredicateGalleryObs`). Only shared
 * types live here.
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
}

/** Hard cap to keep first paint snappy. UI surfaces a "showing top N" hint when truncated. */
export const MAX_GALLERY_OBS = 5000;
