import type { FilterCoordinationAPI, RowIndex } from "@ndea/sdk";
import type { Coordinator } from "@uwdata/mosaic-core";
import { column, type FilterExpr, literal, Query } from "@uwdata/mosaic-sql";
import { useCallback, useState } from "react";
import { filterExprToExpr, toRows } from "../../helpers";
import { useMosaicClient } from "../../../query/useMosaicClient";

export function hasFilterPredicate(predicate: FilterExpr | null | undefined): boolean {
  if (predicate == null) return false;
  if (Array.isArray(predicate)) return predicate.some(hasFilterPredicate);
  if (typeof predicate === "boolean") return !predicate;
  const sql = predicate.toString().trim().toLowerCase();
  return sql !== "" && sql !== "null" && sql !== "true";
}

export function predicateRowIndexQuery(table: string, predicate: FilterExpr) {
  return Query.from(table)
    .select({ rowIndex: column("__row_index__") })
    .where(hasFilterPredicate(predicate) ? filterExprToExpr(predicate) : literal(false));
}

export function predicateMaskRows(active: boolean, rows: RowIndex[] | null): RowIndex[] | null {
  return active ? rows : null;
}

/**
 * Resolve the combined filter selection to app row IDs without rebuilding the
 * scatter's immutable position and color buffers.
 */
export function usePredicateRowIndices(options: {
  coordinator: Coordinator;
  filter: FilterCoordinationAPI;
  table: string;
}): {
  rowIndices: RowIndex[] | null;
  error: Error | null;
} {
  const { coordinator, filter, table } = options;
  const [active, setActive] = useState(false);

  const query = useCallback(
    (predicate: FilterExpr) => {
      const nextActive = hasFilterPredicate(predicate);
      setActive(nextActive);
      return predicateRowIndexQuery(table, predicate);
    },
    [table],
  );
  const transform = useCallback(
    (result: unknown) => toRows<{ rowIndex: RowIndex }>(result).map((row) => row.rowIndex),
    [],
  );
  const { data, error } = useMosaicClient<RowIndex[]>({
    coordinator,
    filter,
    filterStable: false,
    query,
    transform,
  });

  return { rowIndices: predicateMaskRows(active, data), error };
}
