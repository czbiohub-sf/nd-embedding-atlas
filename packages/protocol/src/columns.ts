/**
 * The column catalog: the `dataset` VIEW's columns as `GET /api/columns`
 * reports them, plus the SQL identifier quoting every column name goes through.
 */

import { z } from "zod";

/** What a picker or grid can do with a column. */
const ColumnTypeSchema = z.enum(["string", "number", "boolean", "other"]);
export type ColumnType = z.infer<typeof ColumnTypeSchema>;

/** Where a `dataset` VIEW column comes from. */
const ColumnKindSchema = z.enum(["obs", "var", "annotation"]);
export type ColumnKind = z.infer<typeof ColumnKindSchema>;

const CatalogColumnSchema = z.object({
  name: z.string(),
  type: ColumnTypeSchema,
  /** DuckDB's type name, e.g. `VARCHAR`, `DOUBLE`. */
  sqlType: z.string(),
  kind: ColumnKindSchema,
});
export type CatalogColumn = z.infer<typeof CatalogColumnSchema>;

/** GET /api/columns: VIEW order, internal `__*` columns excluded. */
export const ColumnCatalogSchema = z.array(CatalogColumnSchema);

/** DuckDB type name to column type. */
export function columnType(sqlType: string): ColumnType {
  const d = sqlType.toUpperCase();
  // First: an ENUM's type string lists its categories, which may contain "INT", "REAL", "BOOL"...
  if (d.startsWith("ENUM")) return "string";
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

/**
 * Quote a column name as a SQL identifier: wrap in double quotes, double any
 * embedded double quote. The only safe way to interpolate a user-influenced
 * name: a bare `"${name}"` lets a name containing `"` break out of the
 * identifier and inject statements.
 */
export function quoteIdent(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}
