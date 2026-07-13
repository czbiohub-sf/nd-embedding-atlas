/**
 * Per-channel pixel statistics for autocontrast.
 *
 * Reads the COARSEST OME-Zarr pyramid level for a FOV (not level 0 like the
 * crop path — the pyramid IS the decimation, so a thumbnail-sized level gives a
 * representative histogram for ~free) and computes, per channel: a 256-bin
 * histogram, saturation-percentile limits (Fiji-style), and the raw min/max
 * (napari-style). The frontend picks which method to apply.
 *
 * ponytail: computed on the main thread, not the CropPool worker — it runs once
 * per FOV over a tiny coarse level and the result is cached forever (pixels are
 * immutable). Move to the worker only if it ever shows up in latency.
 */

import FileSystemStore from "@zarrita/storage/fs";
import * as zarr from "zarrita";
import type { ChannelStat } from "@ndea/protocol";

const BIN_COUNT = 256;
// Fiji "Auto B&C" saturates a small fraction of pixels at each end. These read
// well on fluorescence (heavy background spike at 0, long bright tail).
const LOW_PCT = 0.01;
const HIGH_PCT = 0.998;
// Smallest acceptable coarse level — below this a histogram is too sparse to
// trust, so we step toward finer levels until a plane has enough pixels.
const MIN_EDGE = 64;
const MAX_LEVELS = 16;

const storeCache = new Map<string, FileSystemStore>();
function storeFor(diskPath: string): FileSystemStore {
  const cached = storeCache.get(diskPath);
  if (cached) return cached;
  const store = new FileSystemStore(diskPath);
  storeCache.set(diskPath, store);
  return store;
}

// Cache key: diskPath::fov. Pixels are immutable, so this never invalidates.
const statsCache = new Map<string, ChannelStat[]>();

/** Open multiscale levels 0..N for a FOV, returning them finest-first. */
async function openLevels(store: FileSystemStore, fovPath: string): Promise<zarr.Array<zarr.DataType>[]> {
  const base = `/${fovPath.replace(/^\/+/, "")}`;
  const levels: zarr.Array<zarr.DataType>[] = [];
  for (let i = 0; i < MAX_LEVELS; i++) {
    try {
      levels.push(await zarr.open(zarr.root(store).resolve(`${base}/${i}`), { kind: "array" }));
    } catch {
      break; // first missing index ends the pyramid
    }
  }
  if (levels.length === 0) throw new Error(`No image arrays under ${base}`);
  return levels;
}

/** Pick the coarsest level whose Y/X plane still has >= MIN_EDGE on each side. */
function pickLevel(levels: zarr.Array<zarr.DataType>[]): zarr.Array<zarr.DataType> {
  for (let i = levels.length - 1; i >= 0; i--) {
    const shape = levels[i].shape;
    const nY = shape[shape.length - 2];
    const nX = shape[shape.length - 1];
    if (nY >= MIN_EDGE && nX >= MIN_EDGE) return levels[i];
  }
  return levels[0]; // image smaller than MIN_EDGE everywhere — use finest
}

/** Histogram + percentile + extent for one channel plane. Exported for tests. */
export function statOf(data: ArrayLike<number>): ChannelStat {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < data.length; i++) {
    const v = data[i];
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    min = 0;
    max = 1;
  }
  if (min === max) max = min + 1;

  const bins = new Uint32Array(BIN_COUNT);
  const scale = BIN_COUNT / (max - min);
  for (let i = 0; i < data.length; i++) {
    let b = Math.floor((data[i] - min) * scale);
    if (b < 0) b = 0;
    else if (b >= BIN_COUNT) b = BIN_COUNT - 1;
    bins[b]++;
  }

  const total = data.length;
  const binW = (max - min) / BIN_COUNT;
  const percentile = (p: number): number => {
    const target = total * p;
    let cum = 0;
    for (let b = 0; b < BIN_COUNT; b++) {
      cum += bins[b];
      if (cum >= target) return min + (b + 0.5) * binW;
    }
    return max;
  };

  const lo = percentile(LOW_PCT);
  const hi = percentile(HIGH_PCT);
  return { lo, hi: hi > lo ? hi : lo + 1, dataMin: min, dataMax: max, bins: Array.from(bins) };
}

/** Compute per-channel stats for a FOV, reading the coarsest pyramid level. */
export async function computeChannelStats(diskPath: string, fovPath: string): Promise<ChannelStat[]> {
  const key = `${diskPath}::${fovPath}`;
  const cached = statsCache.get(key);
  if (cached) return cached;

  const store = storeFor(diskPath);
  const arr = pickLevel(await openLevels(store, fovPath));

  // Shape is [T, C, Z, Y, X] per OME-Zarr. Sample t=0, middle Z plane.
  const [nT, nC, nZ] = arr.shape;
  const t = nT > 0 ? 0 : 0;
  const z = nZ > 1 ? Math.floor(nZ / 2) : 0;

  const stats: ChannelStat[] = [];
  for (let c = 0; c < nC; c++) {
    const plane = await zarr.get(arr, [t, c, z, null, null]);
    stats.push(statOf((plane as { data: ArrayLike<number> }).data));
  }

  statsCache.set(key, stats);
  return stats;
}
