/**
 * DataFrame → DuckDB ingestion via the Appender API.
 *
 * Shared between obs_base and var_base paths. Single-dataset: appends every
 * row as-is. Multi-dataset union: caller prepends the `_dataset` column to the
 * schema and passes it per-dataset via `datasetName`.
 */

import type { DuckDBConnection } from "@duckdb/node-api";
import type { Column } from "@uwdata/flechette";
import type { LazyDataFrame } from "./data-frame.ts";

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
  df: LazyDataFrame,
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
  dfs: readonly LazyDataFrame[],
  options: IngestOptions = {},
): Promise<readonly string[]> {
  if (dfs.length === 0) throw new Error(`ingestDataFrames: no DataFrames for table "${tableName}"`);

  const arrows = dfs.map((df) => df.toArrow());
  const columnOrder = options.columnOrder ?? unionColumns(arrows);
  const layout = resolveLayout(options);
  const columnTypes = collectColumnTypes(arrows);

  await conn.run(`CREATE TABLE ${tableName} (${buildColumnDefs(layout, columnOrder, columnTypes).join(", ")})`);

  let globalIndex = 0;
  for (let d = 0; d < dfs.length; d++) {
    globalIndex = await appendOneDataFrame(conn, tableName, dfs[d], arrows[d], columnOrder, layout, {
      datasetName: options.datasetNames?.[d],
      startIndex: globalIndex,
    });
  }

  return columnOrder;
}

interface IngestLayout {
  axis: "obs" | "var" | undefined;
  includeName: boolean;
  hasDatasetCol: boolean;
}

function resolveLayout(options: IngestOptions): IngestLayout {
  const axis = options.axis;
  return {
    axis,
    includeName: options.includeNameColumn === true && axis !== undefined,
    hasDatasetCol: options.datasetNames !== undefined && options.datasetNames.length > 1,
  };
}

function collectColumnTypes(arrows: readonly { names: readonly string[]; getChild(n: string): ArrowColumn | null }[]) {
  // Type resolution: first DF to carry a column wins.
  const columnTypes = new Map<string, unknown>();
  for (const a of arrows) {
    for (const name of a.names) {
      if (columnTypes.has(name)) continue;
      const col = a.getChild(name);
      if (col) columnTypes.set(name, col.type);
    }
  }
  return columnTypes;
}

function buildColumnDefs(
  layout: IngestLayout,
  columnOrder: readonly string[],
  columnTypes: Map<string, unknown>,
): string[] {
  const colDefs: string[] = [];
  if (layout.axis) colDefs.push(`__${layout.axis}_index__ INTEGER`);
  if (layout.includeName) colDefs.push(`${layout.axis}_name VARCHAR`);
  if (layout.hasDatasetCol) colDefs.push(`"_dataset" VARCHAR`);
  for (const name of columnOrder) {
    colDefs.push(`"${name}" ${arrowTypeToDuckDB(columnTypes.get(name))}`);
  }
  return colDefs;
}

interface ColumnPlan {
  col: ArrowColumn | null;
  append: RowAppender;
}

function planColumns(
  arrow: { names: readonly string[]; getChild(n: string): ArrowColumn | null },
  columnOrder: readonly string[],
): ColumnPlan[] {
  const presentNames = new Set(arrow.names);
  return columnOrder.map((n) => {
    const col = presentNames.has(n) ? (arrow.getChild(n) ?? null) : null;
    return { col, append: col ? resolveAppender(col.type) : APPEND_NULL };
  });
}

async function appendOneDataFrame(
  conn: DuckDBConnection,
  tableName: string,
  df: LazyDataFrame,
  arrow: ReturnType<LazyDataFrame["toArrow"]>,
  columnOrder: readonly string[],
  layout: IngestLayout,
  context: { datasetName?: string; startIndex: number },
): Promise<number> {
  const plans = planColumns(arrow, columnOrder);
  const appender = await conn.createAppender(tableName);
  const n = arrow.numRows;
  const idx = df.index;
  const datasetName = context.datasetName ?? "";
  let globalIndex = context.startIndex;

  for (let r = 0; r < n; r++) {
    if (layout.axis) appender.appendInteger(globalIndex++);
    if (layout.includeName) {
      const name = typeof idx === "object" && "length" in idx ? String(idx[r]) : "";
      appender.appendVarchar(name);
    }
    if (layout.hasDatasetCol) appender.appendVarchar(datasetName);
    for (let c = 0; c < plans.length; c++) {
      const { col, append } = plans[c];
      if (col == null) {
        appender.appendNull();
        continue;
      }
      const val = col.at(r);
      if (val == null) appender.appendNull();
      else append(appender, val);
    }
    appender.endRow();
  }
  appender.closeSync();
  return globalIndex;
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

const INT_DUCKDB_TYPES: Record<number, [signed: string, unsigned: string]> = {
  8: ["TINYINT", "UTINYINT"],
  16: ["SMALLINT", "USMALLINT"],
  32: ["INTEGER", "UINTEGER"],
  64: ["BIGINT", "UBIGINT"],
};

function intDuckDBType(width: number, signed: boolean): string {
  const pair = INT_DUCKDB_TYPES[width] ?? INT_DUCKDB_TYPES[64];
  return signed ? pair[0] : pair[1];
}

export function arrowTypeToDuckDB(type: unknown): string {
  if (!type || typeof type !== "object") return "VARCHAR";
  const t = type as { typeId: number; bitWidth?: number; signed?: boolean; precision?: number };
  switch (t.typeId) {
    case 2:
      return intDuckDBType(t.bitWidth ?? 32, t.signed ?? true);
    case 3:
      return t.precision === 2 ? "DOUBLE" : "FLOAT";
    case 6:
      return "BOOLEAN";
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

/** Per-column appender that assumes `val` is non-null (caller checks). */
type RowAppender = (appender: AppenderLike, val: unknown) => void;

const APPEND_NULL: RowAppender = (a) => a.appendNull();
const APPEND_VARCHAR: RowAppender = (a, v) => a.appendVarchar(stringifyPrimitive(v));
const APPEND_BOOL: RowAppender = (a, v) => a.appendBoolean(Boolean(v));
const APPEND_FLOAT: RowAppender = (a, v) => a.appendFloat(Number(v));
const APPEND_DOUBLE: RowAppender = (a, v) => a.appendDouble(Number(v));

function makeIntAppender(width: number, signed: boolean): RowAppender {
  if (width === 64) {
    const fn: keyof AppenderLike = signed ? "appendBigInt" : "appendUBigInt";
    return (a, v) => {
      const big = typeof v === "bigint" ? v : BigInt(Math.trunc(Number(v)));
      (a[fn] as (b: bigint) => void)(big);
    };
  }
  let fn: keyof AppenderLike;
  if (width === 8) fn = signed ? "appendTinyInt" : "appendUTinyInt";
  else if (width === 16) fn = signed ? "appendSmallInt" : "appendUSmallInt";
  else fn = signed ? "appendInteger" : "appendUInteger";
  return (a, v) => (a[fn] as (n: number) => void)(Number(v));
}

/** Resolve a per-column appender for an Arrow type. Returned fn assumes non-null. */
function resolveAppender(type: unknown): RowAppender {
  if (!type || typeof type !== "object") return APPEND_VARCHAR;
  const t = type as { typeId: number; bitWidth?: number; signed?: boolean; precision?: number };
  switch (t.typeId) {
    case 1:
      return APPEND_NULL;
    case 2:
      return makeIntAppender(t.bitWidth ?? 32, t.signed ?? true);
    case 3:
      return t.precision === 2 ? APPEND_DOUBLE : APPEND_FLOAT;
    case 6:
      return APPEND_BOOL;
    default:
      return APPEND_VARCHAR;
  }
}

export function appendArrowValue(appender: AppenderLike, val: unknown, type: unknown): void {
  if (val == null) appender.appendNull();
  else resolveAppender(type)(appender, val);
}
