/**
 * useLassoSelectionObs — selection store + active-filter store → obs metadata.
 *
 * Subscribes to selectionSyncStore for the live row-ID set (Roaring bitmap)
 * and the SelectionBus revision sentinel for predicate changes. When either
 * changes, batch-fetches spatial metadata (fov, t, x, y) for the selected rows
 * via POST `/api/obs/batch`.
 *
 * Returns the resolved obs list, ready to feed into the gallery's per-card
 * crop fetch (useGalleryCropQuery). N is bounded — caller is expected to
 * cap selection size before calling.
 */

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSelector } from "@tanstack/react-store";
import { useMemo } from "react";
import { selectionBus } from "../../core/buses";
import { getBitmapRowIds } from "../../stores/RoaringBroadcastStore";
import { selectionSyncStore } from "../../stores/SelectionSyncStore";
import { obsCoordKey } from "../table/useGalleryCropQuery";

export interface LassoObs {
  rowIndex: number;
  fov: string | null;
  t: number;
  x: number;
  y: number;
  /** Dataset key in multi-dataset mode; undefined for single-dataset stores. */
  datasetKey: string | undefined;
}

export interface UseLassoSelectionObsResult {
  obs: LassoObs[];
  rowCount: number;
  isLoading: boolean;
  isError: boolean;
  /** Source kind currently broadcasting — "panel" (lasso) or "external" (collection). */
  sourceKind: "panel" | "external" | null;
}

/** Hard cap to keep first paint snappy. UI surfaces a "showing top N" hint when truncated. */
const MAX_GALLERY_OBS = 5000;

export function useLassoSelectionObs(): UseLassoSelectionObsResult {
  const sync = useSelector(selectionSyncStore, (s) => s);
  // Track the SelectionBus revision so collection toggles re-trigger the batch
  // fetch even if the bitmap source identity hasn't changed.
  const filterVersion = useSelector(selectionBus.revision, (v) => v);
  const queryClient = useQueryClient();

  const rowIds = useMemo(() => {
    if (sync.type !== "active") return [] as number[];
    const all = getBitmapRowIds(sync.source);
    return all.length > MAX_GALLERY_OBS ? all.slice(0, MAX_GALLERY_OBS) : all;
    // filterVersion participates as a sentinel — collection toggles bump it
    // even when sync.source identity is unchanged, forcing recomputation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sync, filterVersion]);

  const totalCount = sync.type === "active" ? getBitmapRowIds(sync.source).length : 0;

  const query = useQuery<LassoObs[]>({
    queryKey: ["lasso-obs", filterVersion, rowIds.length, rowIds[0] ?? null, rowIds[rowIds.length - 1] ?? null],
    queryFn: async ({ signal }) => {
      if (rowIds.length === 0) return [];
      // POST not GET — selections at MAX_GALLERY_OBS would otherwise overflow
      // the server's request header size limit (Bun default ≈8KB).
      const r = await fetch(`/api/obs/batch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ row_indices: rowIds }),
        signal,
      });
      if (!r.ok) throw new Error(`obs/batch failed: ${r.status}`);
      const data = (await r.json()) as Record<
        string,
        { x: number; y: number; fov?: string; t?: number; dataset?: string }
      >;

      // Pre-populate the per-obs coord cache that useGalleryCropQuery falls
      // back to — saves N redundant /api/obs/{rowIndex} round-trips when the
      // gallery cards mount. Mirrors TrackGallery.tsx:128-138.
      for (const [idStr, entry] of Object.entries(data)) {
        queryClient.setQueryData(obsCoordKey(Number(idStr)), { x: entry.x, y: entry.y });
      }

      return rowIds
        .map((id) => {
          const entry = data[String(id)];
          if (!entry) return null;
          return {
            rowIndex: id,
            fov: entry.fov ?? null,
            t: entry.t ?? 0,
            x: entry.x,
            y: entry.y,
            datasetKey: entry.dataset,
          };
        })
        .filter((o): o is LassoObs => o !== null);
    },
    enabled: rowIds.length > 0,
    staleTime: Infinity,
    gcTime: 0,
  });

  return {
    obs: query.data ?? [],
    rowCount: totalCount,
    isLoading: query.isLoading,
    isError: query.isError,
    sourceKind: sync.type === "active" ? sync.source.kind : null,
  };
}

export { MAX_GALLERY_OBS };
