import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { ChannelDef, ChannelHash } from "./contracts";

/** An obs's place in its image (`/api/obs/batch`). */
interface Spatial {
  x: number;
  y: number;
  fov?: string;
  t?: number;
  z?: number;
  dataset?: string;
}

type Waiter = { resolve(spatial: Spatial | undefined): void; reject(error: unknown): void };
let queued = new Map<number, Waiter[]>();

/** Lookups made within one frame go out as one POST `/api/obs/batch`. */
function loadSpatial(row: number): Promise<Spatial | undefined> {
  return new Promise((resolve, reject) => {
    if (queued.size === 0) setTimeout(flushSpatial, 16);
    queued.set(row, [...(queued.get(row) ?? []), { resolve, reject }]);
  });
}

async function flushSpatial() {
  const batch = queued;
  queued = new Map();
  try {
    const response = await fetch("/api/obs/batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ row_indices: [...batch.keys()] }),
    });
    if (!response.ok) throw new Error(`obs/batch failed: ${response.status}`);
    const data = (await response.json()) as Record<string, Spatial>;
    for (const [row, waiters] of batch) for (const w of waiters) w.resolve(data[row]);
  } catch (error) {
    for (const waiters of batch.values()) for (const w of waiters) w.reject(error);
  }
}

/**
 * Z plane for a crop: the per-obs `z` from the dataframe wins; otherwise the
 * viewer's live Z plane (what was set in idetik), then 0. Rounded because the
 * crop endpoint indexes the zarr Z axis (integer slab).
 */
export function resolveCropZ(rowZ: number | null | undefined, viewerZ: number | null | undefined): number {
  return Math.round(rowZ ?? viewerZ ?? 0);
}

/** Image px either side of the obs at 100% zoom. */
const BASE_HALF = 150;

export interface CropQueryParams {
  row: number;
  /** Tile edge in CSS px; the crop renders at the next of 128/256/512 device px. */
  size: number;
  /** Magnification in percent. */
  zoom: number;
  channels: readonly ChannelDef[];
  hash: ChannelHash;
  viewerZ: number;
  enabled: boolean;
}

/** A composited WebP crop around `row` (POST /api/crop/{fov}) as a data URL. */
export function useCrop({ row, size, zoom, channels, hash, viewerZ, enabled }: CropQueryParams) {
  const half = Math.max(8, Math.round((BASE_HALF * 100) / zoom));
  const px = [128, 256, 512].find((p) => p >= size * (globalThis.devicePixelRatio ?? 1)) ?? 512;
  return useQuery({
    queryKey: ["crop", row, half, px, viewerZ, hash],
    queryFn: async ({ signal }) => {
      const spatial = await loadSpatial(row);
      if (!spatial?.fov) throw new Error(`obs ${row} has no image position`);
      const body = {
        t: spatial.t ?? 0,
        z: resolveCropZ(spatial.z, viewerZ),
        x: Math.round(spatial.x),
        y: Math.round(spatial.y),
        half,
        size: px,
        ...(spatial.dataset ? { dataset_key: spatial.dataset } : {}),
        // cIndex is explicit so a reordered channel list still reads the right zarr C slab.
        channels: channels.map((ch, idx) => ({
          cIndex: idx,
          visible: ch.visible,
          lo: ch.contrastLimits[0],
          hi: ch.contrastLimits[1],
          color: ch.color,
          blend: ch.blendMode,
        })),
      };
      const res = await fetch(`/api/crop/${spatial.fov}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal,
      });
      if (!res.ok) throw new Error(`crop fetch failed: ${res.status}`);
      // A data URL lives and dies with its cache entry: no blob-URL revocation to race a mounted <img>.
      const blob = await res.blob();
      return await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.addEventListener("load", () => resolve(reader.result as string), { once: true });
        reader.addEventListener("error", () => reject(reader.error ?? new Error("crop decode failed")), { once: true });
        reader.readAsDataURL(blob);
      });
    },
    enabled,
    staleTime: Infinity,
    // Short retention: the gallery is virtualized, so only visible tiles hold a crop.
    gcTime: 1000,
    // Hold the last crop while a zoom or channel change refetches.
    placeholderData: keepPreviousData,
  });
}
