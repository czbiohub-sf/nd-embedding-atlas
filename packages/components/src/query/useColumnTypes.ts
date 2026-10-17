import type { Coordinator } from "@uwdata/mosaic-core";
import type { FilterExpr } from "@uwdata/mosaic-sql";
import { useCallback } from "react";
import { type ColumnType, duckdbTypeToColumnType } from "./column-types";
import { toRows } from "./mosaic";
import { useMosaicClient } from "./useMosaicClient";

/**
 * Query column types from DuckDB via `DESCRIBE dataset`.
 * Returns a Map<columnName, ColumnType> or null while loading.
 */
export function useColumnTypes(coordinator: Coordinator): Map<string, ColumnType> | null {
  const query = useCallback((_predicate: FilterExpr) => `SELECT column_name, column_type FROM (DESCRIBE dataset)`, []);

  const transform = useCallback((result: unknown): Map<string, ColumnType> => {
    const rows = toRows<{
      column_name: string;
      column_type: string;
    }>(result);
    const map = new Map<string, ColumnType>();
    for (const row of rows) {
      map.set(row.column_name, duckdbTypeToColumnType(row.column_type));
    }
    return map;
  }, []);

  const { data } = useMosaicClient({ coordinator, query, transform });
  return data;
}
