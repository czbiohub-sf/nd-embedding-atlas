/**
 * Shared viewer state types for the server.
 *
 * Ports the Python `server/_state.py` dataclasses to TypeScript interfaces.
 */

import type { AnnDataAccessor } from "../zarr/anndata-accessor.ts";
import type { PlateChannel, PlateMount } from "./plate.ts";
import type { EmbeddingStore } from "./store.ts";

/** Resolved spatial column names (from config or auto-detection). */
export interface SpatialColumns {
  fov: string | null;
  t: string | null;
  bbox: string | null;
  x: string | null;
  y: string | null;
}

/** Returns the set of columns that should be hidden from the Mosaic VIEW. */
export function spatialHiddenColumns(spatial: SpatialColumns | null): Set<string> {
  if (!spatial?.bbox) return new Set();
  return new Set([spatial.bbox]);
}

/** Rectangular bbox in source-image pixel coordinates. */
export interface BboxRect {
  yMin: number;
  xMin: number;
  yMax: number;
  xMax: number;
}

/** Parse a bbox string like "[y_min x_min y_max x_max]". */
export function parseBbox(raw: string): BboxRect | null {
  const parts = raw.replace(/[[\]]/g, "").trim().split(/\s+/);
  if (parts.length !== 4) return null;
  const nums = parts.map(Number);
  if (nums.some(Number.isNaN)) return null;
  return { yMin: nums[0], xMin: nums[1], yMax: nums[2], xMax: nums[3] };
}

/** Auto-detect spatial column names from the set of available obs columns. */
export function detectSpatialColumns(obsColumns: Set<string>): SpatialColumns {
  const fov = obsColumns.has("fov_name") ? "fov_name" : obsColumns.has("well") ? "well" : null;
  const t = obsColumns.has("t") ? "t" : null;
  const bbox = obsColumns.has("bbox") ? "bbox" : obsColumns.has("cp_bbox") ? "cp_bbox" : null;

  let x: string | null = null;
  let y: string | null = null;
  const candidates: [string, string][] = [
    ["x", "y"],
    ["x_cp1", "y_cp1"],
    ["x_global_pheno", "y_global_pheno"],
  ];
  for (const [xc, yc] of candidates) {
    if (obsColumns.has(xc) && obsColumns.has(yc)) {
      x = xc;
      y = yc;
      break;
    }
  }

  return { fov, t, bbox, x, y };
}

/** Returns all non-null spatial column names. */
export function spatialAllColumns(spatial: SpatialColumns | null): Set<string> {
  if (!spatial) return new Set();
  const cols = new Set<string>();
  for (const v of [spatial.fov, spatial.t, spatial.bbox, spatial.x, spatial.y]) {
    if (v != null) cols.add(v);
  }
  return cols;
}

/** Per-channel rendering configuration. */
export interface ChannelConfig {
  /** Hex color without '#', e.g. "FF0000". */
  color: string;
  contrast?: [number, number];
  visible?: boolean;
}

/** Per-dataset configuration. */
export interface DatasetConfig {
  path: string;
  platePath?: string;
  channels?: Record<string, ChannelConfig>;
}

/** Static per-session metadata for the /data endpoints. */
export interface DatasetMeta {
  obsColumnNames: string[];
  embeddingProps: Record<string, unknown>;
  hasPlate: boolean;
  plateMeta: Record<string, unknown> | null;
  defaultX: string;
  defaultY: string;
  idColumn: string;
  datasetKeys: string[] | null;
  datasetChannels: Record<string, PlateChannel[]> | null;
}

/** All mutable server state for one viewer session. */
export interface ViewerState {
  store: EmbeddingStore;
  datasets: Map<string, DatasetConfig>;
  spatial: SpatialColumns | null;
  obsColumns: string[];
  port: number;
  availableObsmKeys: string[];
  loadingTasks: Map<string, Promise<void>>;
  loadErrors: Map<string, string>;
  /** axial accessors by dataset name — for loading obsm from zarr on demand. */
  accessors: Map<string, AnnDataAccessor>;
  /** URL-mount → disk-path descriptors for OME-Zarr HCS stores. */
  plateMounts: PlateMount[];
}
