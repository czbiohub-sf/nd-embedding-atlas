import type { Coordinator } from "@uwdata/mosaic-core";
import type { FilterExpr } from "@uwdata/mosaic-sql";
import { useCallback } from "react";
import { toRows } from "../lib/mosaic-helpers";
import { useMosaicClient } from "./useMosaicClient";

export type ColumnType = "string" | "number" | "boolean" | "other";

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

function duckdbTypeToColumnType(dtype: string): ColumnType {
  const d = dtype.toUpperCase();
  if (
    d.includes("INT") ||
    d.includes("FLOAT") ||
    d.includes("DOUBLE") ||
    d.includes("DECIMAL") ||
    d.includes("NUMERIC") ||
    d.includes("REAL") ||
    d.includes("HUGEINT") ||
    d.includes("BIGINT") ||
    d.includes("SMALLINT") ||
    d.includes("TINYINT")
  ) {
    return "number";
  }
  if (d.includes("BOOL")) return "boolean";
  if (d.includes("VARCHAR") || d.includes("TEXT") || d.includes("CHAR") || d.includes("STRING") || d.includes("ENUM")) {
    return "string";
  }
  return "other";
}
