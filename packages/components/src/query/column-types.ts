export type ColumnType = "string" | "number" | "boolean" | "other";

/** DuckDB `DESCRIBE` type name to column kind. */
export function duckdbTypeToColumnType(dtype: string): ColumnType {
  const d = dtype.toUpperCase();
  if (
    d.includes("INT") ||
    d.includes("FLOAT") ||
    d.includes("DOUBLE") ||
    d.includes("DECIMAL") ||
    d.includes("NUMERIC") ||
    d.includes("REAL")
  ) {
    return "number";
  }
  if (d.includes("BOOL")) return "boolean";
  if (d.includes("VARCHAR") || d.includes("TEXT") || d.includes("CHAR") || d.includes("STRING") || d.includes("ENUM")) {
    return "string";
  }
  return "other";
}
