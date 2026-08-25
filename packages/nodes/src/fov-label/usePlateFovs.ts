/**
 * usePlateFovs: every FOV in the dataset, with its plate position and effective label.
 *
 * Deliberately NOT scoped to the node's input predicate. The plate geometry is the point:
 * a well that is uniformly bad reads instantly as a grid, and that reading only works if
 * the grid keeps its shape. The label is carried by the cell OUTLINE, never by removing
 * or reflowing cells.
 *
 * Two label columns are read and coalesced: `goodness_user` (written here) wins over
 * `goodness` (imported from shrimPy's offline viewer), so an edit visibly overrides the
 * import without destroying it. See GOODNESS_USER_COLUMN for why they stay separate.
 *
 * Coordinates are batch-prefetched into the same `obsCoordKey` cache `useGalleryCropQuery`
 * reads, so 147 cells cost one POST rather than 147 GETs.
 */

import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { rowIndex } from "@ndea/sdk";
import type { Coordinator } from "@uwdata/mosaic-core";
import { annotationCacheSuffix, useRefetchOnAnnotationWrite } from "../query/annotations";
import { toRows } from "../query/mosaic";
import { obsCoordKey } from "../gallery/useGalleryCropQuery";
import { GOODNESS_COLUMN, GOODNESS_USER_COLUMN, type Goodness, parseGoodness } from "./goodness";

/**
 * Cell values arrive as unknown from the JSON round-trip; coerce only the primitives we
 * expect rather than stringifying whatever turns up.
 */
function asText(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "bigint") return value.toString();
  return "";
}

export interface PlateFov {
  readonly rowIndex: number;
  readonly fovName: string;
  readonly t: number;
  /** `goodness_user` if set, else the imported `goodness`, else "unlabeled". */
  readonly goodness: Goodness;
  /** True when the effective label came from an edit made here rather than the import. */
  readonly isUserLabel: boolean;
  /** Value of the ranking column, when one is selected; null when absent or non-numeric. */
  readonly rankValue: number | null;
  readonly datasetKey?: string;
}

export interface UsePlateFovsResult {
  readonly fovs: readonly PlateFov[];
  readonly isLoading: boolean;
  readonly error: string | null;
  /**
   * Re-read the labels WITHOUT changing the query key.
   *
   * Bumping a revision into the key instead would make react-query treat it as a brand new
   * query: `data` is undefined for a tick, the grid empties, and 147 cells unmount and
   * remount. Refetching the same key keeps the previous rows on screen while the new ones
   * load, so a single label edit no longer flashes the whole plate.
   */
  readonly refetch: () => void;
}

export interface PlateFovsQuery {
  coordinator: Coordinator;
  /** Spatial FOV column, e.g. `fov_name`; null disables the query. */
  fovColumn: string | null;
  tColumn: string | null;
  /** Columns present in the view, so a missing label column is not selected. */
  columns: readonly string[];
  /**
   * Annotation columns that actually exist, from `/api/annotations/columns`.
   *
   * Separate from `columns` because `metadata.obs_columns` NEVER lists them: an annotation
   * lives in an `ann_{name}` table LEFT JOINed into the view. Gating on `obs_columns` alone
   * is why every label ever written was invisible after a reload — the column was simply
   * never selected.
   */
  annotationColumns: readonly string[];
  /** Bumps on every annotation write; defeats Mosaic's SQL-text result cache. */
  annotationRevision: number;
  /** Hold the first query until the annotation column list is known, to avoid a re-key. */
  annotationsReady: boolean;
  /** Numeric column to rank on (e.g. a tuned score); ignored when absent from `columns`. */
  rankColumn: string | null;
}

export function usePlateFovs({
  coordinator,
  fovColumn,
  tColumn,
  columns,
  annotationColumns,
  annotationRevision,
  annotationsReady,
  rankColumn,
}: PlateFovsQuery): UsePlateFovsResult {
  const queryClient = useQueryClient();
  const hasImported = columns.includes(GOODNESS_COLUMN);
  const hasUser = annotationColumns.includes(GOODNESS_USER_COLUMN) || columns.includes(GOODNESS_USER_COLUMN);
  const available = [...columns, ...annotationColumns];
  const rankOn = rankColumn && available.includes(rankColumn) ? rankColumn : null;

  const query = useQuery<PlateFov[]>({
    // The revision is deliberately absent: it drives `refetch` below instead, so a label edit
    // re-reads in place rather than remounting all 147 cells.
    queryKey: ["plate-fovs", fovColumn, tColumn, hasImported, hasUser, rankOn],
    enabled: fovColumn != null && annotationsReady,
    queryFn: async ({ signal }) => {
      if (fovColumn == null) return [];
      const selected = [`__row_index__`, `"${fovColumn}"`];
      if (tColumn) selected.push(`"${tColumn}"`);
      if (hasImported) selected.push(`"${GOODNESS_COLUMN}"`);
      if (hasUser) selected.push(`"${GOODNESS_USER_COLUMN}"`);
      if (rankOn && rankOn !== GOODNESS_COLUMN && rankOn !== GOODNESS_USER_COLUMN) {
        selected.push(`"${rankOn}"`);
      }

      const result = await coordinator.query(
        `SELECT ${selected.join(", ")} FROM dataset ORDER BY __row_index__${annotationCacheSuffix(annotationRevision)}`,
        { type: "json" },
      );
      const rows = toRows(result);

      const fovs: PlateFov[] = rows.map((row) => {
        const user = hasUser ? parseGoodness(row[GOODNESS_USER_COLUMN]) : "unlabeled";
        const imported = hasImported ? parseGoodness(row[GOODNESS_COLUMN]) : "unlabeled";
        const isUserLabel = user !== "unlabeled";
        const rankRaw = rankOn == null ? null : row[rankOn];
        const rankNumber = typeof rankRaw === "number" ? rankRaw : Number(rankRaw);
        return {
          rowIndex: Number(row.__row_index__),
          fovName: asText(row[fovColumn]),
          t: tColumn ? Number(row[tColumn] ?? 0) : 0,
          goodness: isUserLabel ? user : imported,
          isUserLabel,
          rankValue: rankOn != null && Number.isFinite(rankNumber) ? rankNumber : null,
        };
      });

      // Prime the coord cache the crop query falls back on, in one round trip.
      const ids = fovs.map((f) => f.rowIndex);
      if (ids.length > 0) {
        const response = await fetch("/api/obs/batch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ row_indices: ids }),
          signal,
        });
        if (response.ok) {
          const coords = (await response.json()) as Record<string, { x: number; y: number }>;
          for (const fov of fovs) {
            const at = coords[String(fov.rowIndex)];
            if (at) queryClient.setQueryData(obsCoordKey(rowIndex(fov.rowIndex)), { x: at.x, y: at.y });
          }
        }
      }
      return fovs;
    },
  });

  const refetch = useCallback(() => void query.refetch(), [query]);
  // Follow writes made in ANOTHER node (the score node, the annotate table) as well as our own.
  useRefetchOnAnnotationWrite(annotationRevision, refetch);

  return {
    fovs: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error ? String(query.error) : null,
    refetch,
  };
}
