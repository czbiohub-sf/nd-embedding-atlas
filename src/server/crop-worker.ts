/**
 * Worker script for FOV-grouped crop rendering.
 *
 * Each task carries multiple obs requests that share the same FOV. The
 * worker opens the zarr Array once per task (LRU-cached across tasks),
 * reads slabs, composites + WebP-encodes each crop, and streams individual
 * results back via postMessage as they're encoded — first crop in a
 * 30-obs group flushes immediately rather than waiting for the whole group.
 *
 * Message protocol (mirrors src/zarr/column-worker.ts shape):
 *   Main → Worker:  { taskId, mountPath, fovPath, format, quality, size,
 *                     half, channels, requests: [{rowIndex,t,z,x,y}, ...] }
 *   Worker → Main:  per crop:    { taskId, rowIndex, bytes, mime }   (transferable)
 *                   terminal:    { taskId, done: true, errors }
 *                   fatal:       { taskId, error }
 */

declare let self: Worker;

import * as zarr from "zarrita";
import FileSystemStore from "@zarrita/storage/fs";
import { compositeChannels, type ChannelRequest } from "./image.ts";
import { encodeWebpImage } from "./webp.ts";

// ─── Message shapes ─────────────────────────────────────────────────────────

interface CropChannel {
  /** Optional zarr C-axis index. Falls back to array position when undefined. */
  cIndex?: number;
  visible: boolean;
  lo: number;
  hi: number;
  color: string;
  /** Compositing mode (matches viewer's blendMode). Defaults to "additive". */
  blend?: string;
}

interface CropObsRequest {
  rowIndex: number;
  t: number;
  z: number;
  x: number;
  y: number;
}

interface CropTaskMessage {
  taskId: number;
  mountPath: string;
  fovPath: string;
  quality: number;
  size: number;
  half: number;
  channels: CropChannel[];
  requests: CropObsRequest[];
}

// ─── Per-worker caches ──────────────────────────────────────────────────────

// FileSystemStore per disk root. Cheap to hold; ~1 per plate mount.
const storeCache = new Map<string, FileSystemStore>();

function storeFor(mountPath: string): FileSystemStore {
  const cached = storeCache.get(mountPath);
  if (cached) return cached;
  const store = new FileSystemStore(mountPath);
  storeCache.set(mountPath, store);
  return store;
}

// Opened zarr Array per (mount, fov). Holds metadata only (shape, dtype,
// chunk index) — actual chunk bytes are not retained, zarrita reads them
// per `zarr.get`. Bounded LRU at 128 entries to keep memory predictable.
const ARRAY_CACHE_LIMIT = 128;
const arrayCache = new Map<string, zarr.Array<zarr.DataType>>();

async function arrayFor(mountPath: string, fovPath: string): Promise<zarr.Array<zarr.DataType>> {
  const key = `${mountPath}::${fovPath}`;
  const cached = arrayCache.get(key);
  if (cached) {
    // Refresh recency.
    arrayCache.delete(key);
    arrayCache.set(key, cached);
    return cached;
  }
  const store = storeFor(mountPath);
  const imagePath = `/${fovPath.replace(/^\/+/, "")}/0`;
  const arr = await zarr.open(zarr.root(store).resolve(imagePath), { kind: "array" });
  arrayCache.set(key, arr);
  if (arrayCache.size > ARRAY_CACHE_LIMIT) {
    const oldest = arrayCache.keys().next().value;
    if (oldest !== undefined) arrayCache.delete(oldest);
  }
  return arr;
}

// ─── Per-crop render ────────────────────────────────────────────────────────

async function readSlab2D(
  arr: zarr.Array<zarr.DataType>,
  t: number,
  c: number,
  z: number,
  y0: number,
  y1: number,
  x0: number,
  x1: number,
): Promise<Float32Array> {
  const result = await zarr.get(arr, [t, c, z, zarr.slice(y0, y1), zarr.slice(x0, x1)]);
  const data = (result as { data: ArrayLike<number> }).data;
  if (data instanceof Float32Array) return data;
  const n = data.length;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = data[i];
  return out;
}

// Warn at most once per FOV when its requested t/z is out of range, so the log
// shows which FOV's obs t/z doesn't line up with the image dims (e.g. obs `z`
// is a physical coordinate, not a Z-plane index) without flooding per-crop.
const clampWarned = new Set<string>();

async function renderOne(
  arr: zarr.Array<zarr.DataType>,
  fovPath: string,
  nT: number,
  nC: number,
  nZ: number,
  nY: number,
  nX: number,
  channels: CropChannel[],
  req: CropObsRequest,
  half: number,
  size: number,
  quality: number,
): Promise<Uint8Array> {
  // Resolve t/z into the FOV's actual bounds, rendering the nearest valid
  // frame/plane instead of throwing "index out of bounds".
  //
  // 2D image (nZ=1): obs `z` is not a plane index here (e.g. a physical/global
  // z) — collapse to the single plane silently. Only treat obs `z` as a plane
  // index for genuine 3D stacks, and only then is an out-of-range z an anomaly
  // worth flagging. `t` is always a frame index, so an out-of-range t is.
  const t = req.t < 0 ? 0 : req.t >= nT ? nT - 1 : req.t;
  const z = nZ <= 1 ? 0 : req.z < 0 ? 0 : req.z >= nZ ? nZ - 1 : req.z;
  const tClamped = t !== req.t;
  const zClamped = nZ > 1 && z !== req.z;
  if ((tClamped || zClamped) && !clampWarned.has(fovPath)) {
    clampWarned.add(fovPath);
    const parts: string[] = [];
    if (tClamped) parts.push(`t=${req.t}→${t} (nT=${nT})`);
    if (zClamped) parts.push(`z=${req.z}→${z} (nZ=${nZ})`);
    console.warn(`[crop] obs index out of range for fov=${fovPath}: ${parts.join(", ")} — clamped to nearest valid.`);
  }

  const y0 = Math.max(0, req.y - half);
  const y1 = Math.min(nY, req.y + half);
  const x0 = Math.max(0, req.x - half);
  const x1 = Math.min(nX, req.x + half);
  const srcH = y1 - y0;
  const srcW = x1 - x0;
  if (srcH <= 0 || srcW <= 0) {
    throw new Error(`Crop out of bounds: y=[${y0},${y1}] x=[${x0},${x1}]`);
  }

  const channelReqs: ChannelRequest[] = [];
  const slabPromises: Promise<Float32Array>[] = [];
  for (let i = 0; i < channels.length; i++) {
    const ch = channels[i];
    // Honor explicit cIndex if sent; fall back to array position. Skip
    // channels whose cIndex falls outside the FOV's C dimension.
    const c = ch.cIndex ?? i;
    if (c < 0 || c >= nC) continue;
    channelReqs.push({ cIndex: c, visible: ch.visible, lo: ch.lo, hi: ch.hi, color: ch.color, blend: ch.blend });
    slabPromises.push(
      ch.visible ? readSlab2D(arr, t, c, z, y0, y1, x0, x1) : Promise.resolve(new Float32Array(srcH * srcW)),
    );
  }
  const slabs = await Promise.all(slabPromises);

  const rgba = compositeChannels(slabs, channelReqs, srcW, srcH, size, size);
  return encodeWebpImage(rgba, size, size, quality);
}

// ─── Task handler ───────────────────────────────────────────────────────────

async function handleTask(task: CropTaskMessage): Promise<void> {
  const { taskId, mountPath, fovPath, quality, size, half, channels, requests } = task;

  const errors: { rowIndex: number; message: string }[] = [];

  let arr: zarr.Array<zarr.DataType>;
  try {
    arr = await arrayFor(mountPath, fovPath);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    self.postMessage({ taskId, error: `Failed to open FOV ${fovPath}: ${message}` });
    return;
  }

  // Shape: [T, C, Z, Y, X] per OME-Zarr.
  const [nT, nC, nZ, nY, nX] = arr.shape;

  // Pre-sort requests by (t, y, x) so chunk reads land in spatial order →
  // higher hit rate against zarrita's internal chunk cache.
  const sorted = [...requests].toSorted((a, b) => a.t - b.t || a.y - b.y || a.x - b.x);

  // Stream results — postMessage incrementally, one per crop. The next crop
  // benefits from cached chunks but the user sees the first one as soon as
  // it's encoded.
  for (const req of sorted) {
    try {
      const bytes = await renderOne(arr, fovPath, nT, nC, nZ, nY, nX, channels, req, half, size, quality);
      // Transfer the underlying ArrayBuffer so the bytes don't get copied
      // across the worker boundary. Per Bun docs (web-compatible Worker
      // API), postMessage takes `(data, transferList)`.
      self.postMessage({ taskId, rowIndex: req.rowIndex, bytes }, [bytes.buffer]);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push({ rowIndex: req.rowIndex, message });
    }
  }

  self.postMessage({ taskId, done: true, errors });
}

// Sync listener that delegates to the async handler — keeps `no-misused-promises`
// happy and matches the Web Worker spec (handlers should not return promises).
self.addEventListener("message", (event: MessageEvent<CropTaskMessage>) => {
  void handleTask(event.data);
});
