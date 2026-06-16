import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSelector } from "@tanstack/react-store";
import type { ChannelHash } from "../../lib/branded-types";
import { viewerZStore } from "../../stores/ViewerZStore";
import type { TrajectoryFrame } from "../../types";
import type { ChannelDef } from "../viewer/ViewerContext";

/** Stable query key for a single obs coordinate lookup. */
export const obsCoordKey = (rowIndex: number) => ["obs-coord", rowIndex] as const;

interface GalleryCropQueryParams {
  fovName: string;
  datasetKey?: string;
  frame: TrajectoryFrame;
  channels: readonly ChannelDef[];
  hash: ChannelHash;
  enabled: boolean;
}

/**
 * Fetches a composited WebP crop from POST /api/crop/{fov_path}.
 *
 * x/y are FOV-local pixel coordinates straight from obs (the obsCoordKey cache,
 * else /api/obs/{rowIndex}); z is resolved per-obs with a viewer-Z fallback.
 * Blob URL lifecycle is managed at the gallery level (gcTime: 0 + cleanup revocation).
 */
export function useGalleryCropQuery({ fovName, datasetKey, frame, channels, hash, enabled }: GalleryCropQueryParams) {
  const queryClient = useQueryClient();

  // Z plane: per-obs `z` from the dataframe wins; otherwise fall back to the
  // viewer's live Z plane (what was set in idetik), then 0. Rounded because the
  // crop endpoint indexes the zarr Z axis (integer slab).
  const viewerZ = useSelector(viewerZStore, (s) => s.slots[datasetKey ?? "docked"]);
  const z = Math.round(frame.z ?? viewerZ ?? 0);

  return useQuery<string>({
    // rowIndex is essential: many cells share (fov, t) — a lasso selection
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
        const cached = queryClient.getQueryData<{ x: number; y: number }>(obsCoordKey(frame.rowIndex));
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
            queryClient.setQueryData(obsCoordKey(frame.rowIndex), { x: xPx, y: yPx });
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

      const blob = await res.blob();

      // Check abort before allocating blob URL — prevents orphaned URLs
      // if abort fires between res.blob() and URL.createObjectURL()
      if (signal.aborted) throw new DOMException("Aborted before blob URL allocation", "AbortError");

      return URL.createObjectURL(blob);
    },
    enabled,
    staleTime: Infinity, // same (fov, t, hash) always produces same image
    // Brief grace period (1s) before evicting + revoking. With gcTime=0, the
    // old query was evicted the instant the card swapped to a new (fov, t, hash),
    // which fired URL.revokeObjectURL on the URL that `placeholderData:
    // keepPreviousData` was still painting → ~1 frame of broken-image black
    // between selections. 1s is well past typical fetch latency (50-500ms)
    // but still aggressive enough to keep blob memory bounded.
    gcTime: 1000,
    // Hold the prior blob URL while a new (fov, t, hash) query is fetching.
    placeholderData: keepPreviousData,
  });
}
