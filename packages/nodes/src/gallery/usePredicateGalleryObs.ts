/**
 * usePredicateGalleryObs: wired-input predicate → obs metadata.
 *
 * The node-scoped counterpart to `useLassoSelectionObs`: instead of reading the
 * GLOBAL selection bitmap, it resolves the gallery node's OWN cooked input
 * predicate (`host.inputPredicate` → `predicateToSql`) to row ids via the
 * coordinator, then batch-fetches spatial metadata (fov, t, x, y) for those
 * rows via POST `/api/obs/batch`.
 *
 * Returns the identical shape to `useLassoSelectionObs` so `GalleryPane` stays a
 * drop-in consumer. Row ids are capped at MAX_GALLERY_OBS; the UI surfaces a
 * "showing top N" hint when truncated.
 *
 * Reactivity: the obs query is keyed on the predicate SQL TEXT. When the
 * upstream node re-cooks and `host.inputPredicate` emits a different predicate,
 * the key changes and the query refetches. A pinned Cache node emits a
 * STABLE predicate (no mutable temp-table reference), so no per-revision
 * cache-buster is needed: the predicate text fully identifies the result.
 */

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { rowIndex } from "@ndea/sdk";
import type { Coordinator } from "@uwdata/mosaic-core";
import { toRows } from "../query/mosaic";
import { obsCoordKey } from "./useGalleryCropQuery";
import type { LassoObs, UseLassoSelectionObsResult } from "./useLassoSelectionObs";
import { MAX_GALLERY_OBS } from "./useLassoSelectionObs";

/**
 * @param coordinator Mosaic coordinator from the node's `host.data`.
 * @param predicate   SQL WHERE predicate from `predicateToSql(host.inputPredicate)`;
 *                    null when the node is unwired (→ empty result).
 */
export function usePredicateGalleryObs(coordinator: Coordinator, predicate: string | null): UseLassoSelectionObsResult {
  const queryClient = useQueryClient();

  const query = useQuery<{ obs: LassoObs[]; total: number }>({
    // Keyed on the predicate TEXT so the query refetches when the wired
    // input re-cooks to a different predicate, and reuses across renders of
    // the same predicate. Mosaic's QueryManager likewise caches the inner
    // coordinator query by raw SQL text: a stable predicate is safe.
    queryKey: ["predicate-gallery-obs", predicate],
    queryFn: async ({ signal }) => {
      if (predicate == null) return { obs: [], total: 0 };

      // 1. Resolve the wired predicate → row ids (capped). Mirrors
      //    ScatterView's continuous-range isolation query.
      const rowResult = await coordinator.query(
        // ORDER BY for deterministic truncation: "showing top N" is the first
        // N by row index, not an arbitrary scan-order subset.
        `SELECT __row_index__ FROM dataset WHERE ${predicate} ORDER BY __row_index__ LIMIT ${MAX_GALLERY_OBS}`,
        { type: "json" },
      );
      const rowIds = toRows<{ __row_index__: number }>(rowResult).map((r) => rowIndex(r.__row_index__));

      // True selection size (uncapped) for the header / "showing top N".
      const countResult = await coordinator.query(`SELECT COUNT(*)::INT AS n FROM dataset WHERE ${predicate}`, {
        type: "json",
      });
      const total = toRows<{ n: number }>(countResult)[0]?.n ?? rowIds.length;

      if (rowIds.length === 0) return { obs: [], total };

      // 2. Batch-fetch spatial metadata. POST not GET: selections at
      //    MAX_GALLERY_OBS would overflow the server header size limit.
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

      // 3. Pre-populate the per-obs coord cache that useGalleryCropQuery
      //    falls back to: saves N redundant /api/obs/{rowIndex}
      //    round-trips when the cards mount.
      for (const [idStr, entry] of Object.entries(data)) {
        queryClient.setQueryData(obsCoordKey(rowIndex(Number(idStr))), { x: entry.x, y: entry.y });
      }

      const obs = rowIds
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

      return { obs, total };
    },
    enabled: predicate != null,
    staleTime: Infinity,
    gcTime: 0,
  });

  return {
    obs: query.data?.obs ?? [],
    rowCount: query.data?.total ?? 0,
    isLoading: query.isLoading,
    isError: query.isError,
    // Node-scoped: the source is the wired input edge, not the global bus.
    sourceKind: predicate != null ? "input" : null,
  };
}
