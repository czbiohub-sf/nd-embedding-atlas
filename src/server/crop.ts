/**
 * Crop request / response types.
 *
 * The actual rendering pipeline (zarr read → composite → WebP encode)
 * lives in the Bun Worker pool — see crop-pool.ts and crop-worker.ts. The
 * route handler dispatches into the pool via `state.cropPool.renderOne(...)`.
 *
 * Crops are always WebP — PNG was dropped once the worker pool landed.
 */

export interface CropRequest {
  fovPath: string;
  datasetKey?: string;
  t: number;
  z: number;
  x: number;
  y: number;
  /** Half-size of the crop in source pixels. */
  half: number;
  /** Output image size (pixels, square). Defaults to 2*half. */
  size?: number;
  /** WebP quality 0-100. Default 78 (gallery thumbs); single-obs viewer can pass 90. */
  quality?: number;
  channels: {
    visible: boolean;
    lo: number;
    hi: number;
    /** Hex without '#'. */
    color: string;
  }[];
}
