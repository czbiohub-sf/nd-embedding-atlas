/**
 * Shared viewer state types for the server.
 *
 * Ports the Python `server/_state.py` dataclasses to TypeScript interfaces.
 */

import type { DatasetHandle } from "@ndea/zarr";
import type { CropPool } from "./crop-pool.ts";
import type { PlateChannel, PlateMount } from "./plate.ts";
import type { ObsmSliceLoader } from "./slice-loader.ts";
import type { DatasetQuerySession } from "./store.ts";

/** Resolved spatial column names (from config or auto-detection). */
export interface SpatialColumns {
  fov: string | null;
  t: string | null;
  bbox: string | null;
  x: string | null;
  y: string | null;
  /** Per-obs Z plane (optional). Crops render at this Z when present. */
  z: string | null;
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
  const z = obsColumns.has("z")
    ? "z"
    : obsColumns.has("z_slice")
      ? "z_slice"
      : obsColumns.has("plane")
        ? "plane"
        : null;

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

  return { fov, t, bbox, x, y, z };
}

/** Returns all non-null spatial column names. */
export function spatialAllColumns(spatial: SpatialColumns | null): Set<string> {
  if (!spatial) return new Set();
  const cols = new Set<string>();
  for (const v of [spatial.fov, spatial.t, spatial.bbox, spatial.x, spatial.y, spatial.z]) {
    if (v != null) cols.add(v);
  }
  return cols;
}

/** Per-channel rendering configuration for one mounted dataset. */
export interface DatasetChannelConfig {
  /** Hex color without '#', e.g. "FF0000". */
  color: string;
  contrast?: [number, number];
  visible?: boolean;
}

/** Mount configuration for one dataset in a server session. */
export interface DatasetMountConfig {
  path: string;
  platePath?: string;
  channels?: Record<string, DatasetChannelConfig>;
}

/** Static per-session metadata for the /data endpoints. */
export interface DatasetSessionMetadata {
  obsColumnNames: string[];
  embeddingProps: Record<string, unknown>;
  hasPlate: boolean;
  plateMeta: Record<string, unknown> | null;
  defaultX: string;
  defaultY: string;
  idColumn: string;
  datasetKeys: string[] | null;
  datasetChannels: Record<string, PlateChannel[]> | null;
  /** Active preset name; the frontend resolves it to a bundled graph in a build. */
  preset?: string;
}

/** All mutable server state for one server session. */
export interface ServerSession {
  store: DatasetQuerySession;
  datasets: Map<string, DatasetMountConfig>;
  spatial: SpatialColumns | null;
  obsColumns: string[];
  port: number;
  availableObsmKeys: string[];
  loadingTasks: Map<string, Promise<void>>;
  loadErrors: Map<string, string>;
  /** Dataset handles by name — AnnData or MuData. For loading obsm / getX on demand. */
  accessors: Map<string, DatasetHandle>;
  /** URL-mount → disk-path descriptors for OME-Zarr HCS stores. */
  plateMounts: PlateMount[];
  /**
   * Column-wise obsm loaders, keyed by embedding key (e.g. "rna:X_umap").
   * Lazily constructed on first use; stitches columns across every
   * accessor so the result aligns to obs_base row order.
   */
  obsmLoaders: Map<string, ObsmSliceLoader>;
  /**
   * Bun Worker pool for OME-Zarr crop rendering. Null when no plate is
   * configured. Lifetime = server lifetime; created in createApp().
   */
  cropPool: CropPool | null;
  /**
   * Path for the combined annotations parquet sidecar.
   * Null if no writable location could be determined (read-only zarr + no
   * ~/.ndea fallback configured). Derived once at startup.
   */
  annotationsSidecarPath: string | null;
}
