/**
 * DataFrame → DuckDB ingestion via the Appender API.
 *
 * Shared between obs_base and var_base paths. Single-dataset: appends every
 * row as-is. Multi-dataset union: caller prepends the `_dataset` column to the
 * schema and passes it per-dataset via `datasetName`.
 */

import type { DuckDBConnection } from "@duckdb/node-api";
import type { Column } from "@uwdata/flechette";
import type { DataFrame } from "./data-frame.ts";

type ArrowColumn = Column<unknown>;

export interface IngestOptions {
  /**
   * Per-DF dataset tags. When length > 1 (or explicitly multi), a `_dataset`
   * VARCHAR column is prepended to the table and populated per-DF. When
   * length ≤ 1 or omitted, the `_dataset` column is skipped.
   */
  datasetNames?: readonly string[];
  /**
   * Explicit column order for the CREATE TABLE schema. Defaults to the union
   * of columns across `dfs` in first-seen order. Absent columns in a given DF
   * append NULL.
   */
  columnOrder?: readonly string[];
  /** Emits `__${axis}_index__ INTEGER` (global across DFs, 0..totalRows-1). */
  axis?: "obs" | "var";
  /** Emits `${axis}_name VARCHAR` from each DF's index. */
  includeNameColumn?: boolean;
}

/**
 * Single-DF convenience. Delegates to `ingestDataFrames`.
 */
export function ingestDataFrame(
  conn: DuckDBConnection,
  tableName: string,
  df: DataFrame,
  options: Omit<IngestOptions, "datasetNames"> & { datasetName?: string } = {},
): Promise<readonly string[]> {
  const { datasetName, ...rest } = options;
  return ingestDataFrames(conn, tableName, [df], {
    ...rest,
    datasetNames: datasetName === undefined ? undefined : [datasetName],
  });
}

/**
 * CREATE TABLE + append rows for one or more DataFrames as a union.
 *
 * Multi-DF semantics:
 *   - Column schema is the UNION of `dfs[*].columns` (first-seen order).
 *   - Per-column type resolution: first DF to carry a column wins the type;
 *     later DFs missing it append NULL.
 *   - `__${axis}_index__` is GLOBAL (0..totalRows-1), not per-DF — matches
 *     how MuData obsmap eventually wants to address rows.
 *   - `_dataset` column only exists when `datasetNames.length > 1`.
 */
export async function ingestDataFrames(
  conn: DuckDBConnection,
  tableName: string,
  dfs: readonly DataFrame[],
  options: IngestOptions = {},
): Promise<readonly string[]> {
  if (dfs.length === 0) throw new Error(`ingestDataFrames: no DataFrames for table "${tableName}"`);

  const arrows = dfs.map((df) => df.toArrow());

  // Union of column names preserving first-seen order across DFs.
  const columnOrder = options.columnOrder ?? unionColumns(arrows);

  // Type resolution: first DF to carry a column wins.
  const columnTypes = new Map<string, unknown>();
  for (const a of arrows) {
    for (const name of a.names) {
      if (columnTypes.has(name)) continue;
      const col = a.getChild(name);
      if (col) columnTypes.set(name, col.type);
    }
  }

  const axis = options.axis;
  const includeName = options.includeNameColumn === true && axis !== undefined;
  const datasetNames = options.datasetNames;
  const hasDatasetCol = datasetNames !== undefined && datasetNames.length > 1;

  const colDefs: string[] = [];
  if (axis) colDefs.push(`__${axis}_index__ INTEGER`);
  if (includeName) colDefs.push(`${axis}_name VARCHAR`);
  if (hasDatasetCol) colDefs.push(`"_dataset" VARCHAR`);
  for (const name of columnOrder) {
    colDefs.push(`"${name}" ${arrowTypeToDuckDB(columnTypes.get(name))}`);
  }
  await conn.run(`CREATE TABLE ${tableName} (${colDefs.join(", ")})`);

  let globalIndex = 0;
  for (let d = 0; d < dfs.length; d++) {
    const df = dfs[d];
    const arrow = arrows[d];
    const datasetName = datasetNames?.[d];
    const presentNames = new Set(arrow.names);
    const columnRefs: (ArrowColumn | null)[] = columnOrder.map((n) =>
      presentNames.has(n) ? (arrow.getChild(n) ?? null) : null,
    );
    const appender = await conn.createAppender(tableName);
    const n = arrow.numRows;
    const idx = df.index;

    for (let r = 0; r < n; r++) {
      if (axis) appender.appendInteger(globalIndex++);
      if (includeName) {
        const name = typeof idx === "object" && "length" in idx ? String(idx[r]) : "";
        appender.appendVarchar(name);
      }
      if (hasDatasetCol) appender.appendVarchar(datasetName ?? "");
      for (let c = 0; c < columnOrder.length; c++) {
        const col = columnRefs[c];
        if (col == null) {
          appender.appendNull();
          continue;
        }
        appendArrowValue(appender, col.at(r), col.type);
      }
      appender.endRow();
    }
    appender.closeSync();
  }

  return columnOrder;
}

function unionColumns(arrows: readonly { names: readonly string[] }[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const a of arrows) {
    for (const n of a.names) {
      if (seen.has(n)) continue;
      seen.add(n);
      out.push(n);
    }
  }
  return out;
}

// ─── Arrow → DuckDB type mapping (moved out of cli/startup.ts) ───────────────

export function arrowTypeToDuckDB(type: unknown): string {
  if (!type || typeof type !== "object") return "VARCHAR";
  const t = type as { typeId: number; bitWidth?: number; signed?: boolean; precision?: number };
  switch (t.typeId) {
    case 1:
      return "VARCHAR";
    case 2: {
      const width = t.bitWidth ?? 32;
      const signed = t.signed ?? true;
      if (width === 8) return signed ? "TINYINT" : "UTINYINT";
      if (width === 16) return signed ? "SMALLINT" : "USMALLINT";
      if (width === 32) return signed ? "INTEGER" : "UINTEGER";
      return signed ? "BIGINT" : "UBIGINT";
    }
    case 3:
      return t.precision === 2 ? "DOUBLE" : "FLOAT";
    case 5:
      return "VARCHAR";
    case 6:
      return "BOOLEAN";
    case -1:
      return "VARCHAR";
    default:
      return "VARCHAR";
  }
}

interface AppenderLike {
  appendNull(): void;
  appendBoolean(v: boolean): void;
  appendTinyInt(v: number): void;
  appendSmallInt(v: number): void;
  appendInteger(v: number): void;
  appendBigInt(v: bigint): void;
  appendUTinyInt(v: number): void;
  appendUSmallInt(v: number): void;
  appendUInteger(v: number): void;
  appendUBigInt(v: bigint): void;
  appendFloat(v: number): void;
  appendDouble(v: number): void;
  appendVarchar(v: string): void;
}

function stringifyPrimitive(val: unknown): string {
  if (typeof val === "string") return val;
  if (typeof val === "number" || typeof val === "bigint" || typeof val === "boolean") return String(val);
  return JSON.stringify(val) ?? "";
}

export function appendArrowValue(appender: AppenderLike, val: unknown, type: unknown): void {
  if (val == null) {
    appender.appendNull();
    return;
  }
  if (!type || typeof type !== "object") {
    appender.appendVarchar(stringifyPrimitive(val));
    return;
  }
  const t = type as { typeId: number; bitWidth?: number; signed?: boolean; precision?: number };
  switch (t.typeId) {
    case 1:
      appender.appendNull();
      return;
    case 2: {
      const width = t.bitWidth ?? 32;
      const signed = t.signed ?? true;
      if (width === 64) {
        const big = typeof val === "bigint" ? val : BigInt(Math.trunc(Number(val)));
        if (signed) appender.appendBigInt(big);
        else appender.appendUBigInt(big);
        return;
      }
      const num = typeof val === "bigint" ? Number(val) : Number(val);
      if (width === 8) (signed ? appender.appendTinyInt : appender.appendUTinyInt).call(appender, num);
      else if (width === 16) (signed ? appender.appendSmallInt : appender.appendUSmallInt).call(appender, num);
      else (signed ? appender.appendInteger : appender.appendUInteger).call(appender, num);
      return;
    }
    case 3: {
      const num = Number(val);
      if (t.precision === 2) appender.appendDouble(num);
      else appender.appendFloat(num);
      return;
    }
    case 5:
    case -1:
      appender.appendVarchar(stringifyPrimitive(val));
      return;
    case 6:
      appender.appendBoolean(Boolean(val));
      return;
    default:
      appender.appendVarchar(stringifyPrimitive(val));
  }
}
