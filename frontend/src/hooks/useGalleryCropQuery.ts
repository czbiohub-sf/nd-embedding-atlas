import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { TrajectoryFrame } from "../types";
import type { ChannelHash } from "../lib/branded-types";
import type { ChannelDef } from "../components/viewer/ViewerContext";

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
 * Coordinates are converted from µm to pixels using plate_pixel_scale.
 * Blob URL lifecycle is managed at the gallery level (gcTime: 0 + cleanup revocation).
 */
export function useGalleryCropQuery({
  fovName,
  datasetKey,
  frame,
  channels,
  hash,
  enabled,
}: GalleryCropQueryParams) {
  const queryClient = useQueryClient();

  return useQuery<string>({
    queryKey: ["crop", fovName, frame.t ?? null, hash],
    queryFn: async ({ signal }) => {
      // Resolve FOV-local pixel coordinates.
      // Prefer pre-populated cache (from batch prefetch in TrackGallery);
      // fall back to individual obs fetch if not yet cached.
      let xPx = 0;
      let yPx = 0;
      if (frame.rowIndex != null) {
        const cached = queryClient.getQueryData<{ x: number; y: number }>(
          obsCoordKey(frame.rowIndex),
        );
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
        z: 0,
        x: xPx,
        y: yPx,
        half: 150,
        size: 200,
        fmt: "webp",
        ...(datasetKey ? { dataset_key: datasetKey } : {}),
        channels: channels.map((ch) => ({
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
        console.error("[useGalleryCropQuery] 422 detail:", detail, "body sent:", body);
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
    gcTime: 0, // evict immediately when no observer → triggers revocation subscription
    placeholderData: undefined,
  });
}
