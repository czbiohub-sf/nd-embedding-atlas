import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { type RowIndex, rowIndex } from "@ndea/sdk";
import type { ChannelDef, ChannelHash } from "./contracts";

interface TrajectoryFrame {
  t: number;
  z?: number;
  rowIndex?: number;
}

/** Stable query key for a single obs coordinate lookup. */
export const obsCoordKey = (value: RowIndex) => ["obs-coord", value] as const;

/** A rendered crop: data URL + its aspect-preserving pixel dimensions. */
export interface CropResult {
  url: string;
  /** Rendered width/height from the `X-Crop-*` headers; 0 if unavailable. */
  w: number;
  h: number;
}

export interface GalleryCropQueryParams {
  fovName: string;
  datasetKey?: string;
  frame: TrajectoryFrame;
  channels: readonly ChannelDef[];
  hash: ChannelHash;
  enabled: boolean;
  viewerZ?: number;
}

/**
 * Fetches a composited WebP crop from POST /api/crop/{fov_path}.
 *
 * x/y are FOV-local pixel coordinates straight from obs (the obsCoordKey cache,
 * else /api/obs/{rowIndex}); z is resolved per-obs with a viewer-Z fallback.
 * Returns a data URL (not a blob URL) so the crop lifecycle is the cache entry's
 * lifecycle: no URL.revokeObjectURL to race against a mounted <img>.
 */
export function useGalleryCropQuery({
  fovName,
  datasetKey,
  frame,
  channels,
  hash,
  enabled,
  viewerZ,
}: GalleryCropQueryParams) {
  const queryClient = useQueryClient();

  // Z plane: per-obs `z` from the dataframe wins; otherwise fall back to the
  // viewer's live Z plane (what was set in idetik), then 0. Rounded because the
  // crop endpoint indexes the zarr Z axis (integer slab).
  const z = Math.round(frame.z ?? viewerZ ?? 0);

  return useQuery<CropResult>({
    // rowIndex is essential: many cells share (fov, t): a lasso selection
    // routinely has multiple obs in the same FOV at the same timepoint. Without
    // the per-obs id they collide on one cache entry and the gallery paints the
    // first-fetched cell's crop for all of them (it diverges from the viewer).
    queryKey: ["crop", fovName, frame.t ?? null, z, frame.rowIndex ?? null, hash],
    queryFn: async ({ signal }) => {
      // Resolve FOV-local pixel coordinates.
      // Prefer pre-populated cache (from batch prefetch in TrackGallery);
      // fall back to individual obs fetch if not yet cached.
      let xPx = 0;
      let yPx = 0;
      if (frame.rowIndex != null) {
        const focusedRowIndex = rowIndex(frame.rowIndex);
        const cached = queryClient.getQueryData<{ x: number; y: number }>(obsCoordKey(focusedRowIndex));
        if (cached) {
          xPx = Math.round(cached.x);
          yPx = Math.round(cached.y);
        } else {
          const obsR = await fetch(`/api/obs/${frame.rowIndex}`, { signal });
          if (obsR.ok) {
            const obs = (await obsR.json()) as { x?: number; y?: number };
            xPx = Math.round(obs.x ?? 0);
            yPx = Math.round(obs.y ?? 0);
            // Populate cache so subsequent renders skip the fetch
            queryClient.setQueryData(obsCoordKey(focusedRowIndex), { x: xPx, y: yPx });
          }
        }
      }

      const body = {
        t: frame.t,
        z,
        x: xPx,
        y: yPx,
        // half stays at 150 src-pixels (same spatial framing as before so the
        // cell-in-crop ratio doesn't change). size bumped to 320 so the WebP
        // is roughly 1:1 with the source region instead of downsampling →
        // sharp at retina 220–240px CSS cards. Adds maybe 5 KB per crop at
        // q=78, well within budget.
        half: 150,
        size: 320,
        ...(datasetKey ? { dataset_key: datasetKey } : {}),
        // Send cIndex explicitly: today it equals array index (1:1 with the
        // zarr C-axis), but a future channel-reorder UI would let the user
        // shuffle the array without changing which physical channel each
        // entry refers to. Server reads the right C-axis slab via cIndex.
        channels: channels.map((ch, idx) => ({
          cIndex: idx,
          visible: ch.visible,
          lo: ch.contrastLimits[0],
          hi: ch.contrastLimits[1],
          color: ch.color,
          blend: ch.blendMode,
        })),
      };

      const res = await fetch(`/api/crop/${fovName}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal,
      });

      if (!res.ok) {
        const detail = await res.json().catch(() => null);
        console.error(`[useGalleryCropQuery] crop failed ${res.status}:`, detail, "body sent:", body);
        throw new Error(`crop fetch failed: ${res.status}`);
      }

      // Rendered dims from the server (aspect-preserving): lets masonry size
      // each tile before the image decodes. 0 if the header is missing.
      const w = Number(res.headers.get("X-Crop-Width")) || 0;
      const h = Number(res.headers.get("X-Crop-Height")) || 0;

      // Data URL, NOT a blob URL: the crop string lives and dies with the
      // React Query cache entry, so there is no URL.revokeObjectURL lifecycle to
      // get wrong. Blob URLs broke here: a revoke fired (gallery unmount, or a
      // gcTime eviction while `keepPreviousData` was still painting the old URL)
      // on a string a mounted <img> was still showing, leaving a broken image.
      // Crops are small (~5–15 KB webp) and the gallery is virtualized (only the
      // visible + overscan cards hold a query), so base64 in cache is cheap.
      const blob = await res.blob();
      if (signal.aborted) throw new DOMException("Aborted before decode", "AbortError");
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.addEventListener("load", () => resolve(reader.result as string), { once: true });
        reader.addEventListener("error", () => reject(reader.error ?? new Error("crop decode failed")), { once: true });
        reader.readAsDataURL(blob);
      });
      return { url: dataUrl, w, h };
    },
    enabled,
    staleTime: Infinity, // same (fov, t, hash) always produces same image
    // Brief grace period before eviction so a card swapping back to a recent
    // (fov, t, hash) hits the cache. Data URLs need no revocation, so this is
    // now purely a cache-retention knob (kept small to bound memory).
    gcTime: 1000,
    // Hold the prior crop while a new (fov, t, hash) query is fetching.
    placeholderData: keepPreviousData,
  });
}
