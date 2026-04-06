import type { Coordinator, Selection } from "@uwdata/mosaic-core";
import type { FilterExpr } from "@uwdata/mosaic-sql";
import { cast, column, count, Query, sum } from "@uwdata/mosaic-sql";
import { useCallback } from "react";
import { useMosaicClient } from "../../hooks/useMosaicClient";
import { filterExprToExpr, toRows } from "../../lib/mosaic-helpers";

export interface CategoryCounts {
  total: number;
  filtered: number;
}

/**
 * Reactively query filtered + total counts per category index.
 * Updates automatically when the Mosaic cross-filter selection changes.
 *
 * Returns a Map<categoryIndex, { total, filtered }>, or null when loading/disabled.
 */
export function useLegendCounts(opts: {
  coordinator: Coordinator;
  selection: Selection;
  table: string;
  categoryCol: string | null;
  /** Called when the category column is missing from the VIEW (stale after backend restart). */
  onStaleColumn?: () => void;
}): Map<number, CategoryCounts> | null {
  const { coordinator, selection, table, categoryCol, onStaleColumn } = opts;

  const query = useCallback(
    (predicate: FilterExpr) => {
      if (!categoryCol) return null;
      const pred = filterExprToExpr(predicate);
      return Query.from(table)
        .select({
          idx: column(categoryCol),
          total: count(),
          filtered: sum(cast(pred, "INT")),
        })
        .groupby(column(categoryCol));
    },
    [table, categoryCol],
  );

  const transform = useCallback((result: unknown): Map<number, CategoryCounts> => {
    const rows = toRows<{ idx: number; total: number; filtered: number }>(result);
    return new Map(rows.map((r) => [r.idx, { total: r.total, filtered: r.filtered }]));
  }, []);

  const { data } = useMosaicClient<Map<number, CategoryCounts>>({
    coordinator,
    selection,
    query,
    transform,
    enabled: categoryCol !== null,
    onError: (err) => {
      if (String(err).includes("not found in FROM clause")) onStaleColumn?.();
    },
  });

  return data;
}
