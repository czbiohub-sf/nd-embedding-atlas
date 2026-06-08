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
import type { CategoricalArray, ColumnData, NullableArray } from "./types.ts";

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

// ─── Streaming ingest: append straight from source columns (no Arrow table) ──
//
// `ingestDataFrames` builds a full flechette Arrow Table (`df.toArrow()`) AND
// decodes categoricals to full string arrays before the Appender drains them —
// multiple coexisting full copies that drive peak RSS (bench Cycle 0-2). This
// variant reads each `AnnDataFrame` source column directly and appends per row,
// keeping categoricals code-encoded (the category string is looked up per row
// and handed to DuckDB's native buffer, never materialized as a JS array).
// Same DuckDB column types + null semantics as the Arrow path, so results are
// identical (enforced by bench/verify.ts).

type CellAppender = (a: AppenderLike, r: number) => void;

function isCategoricalCol(c: ColumnData): c is CategoricalArray {
  return typeof c === "object" && c !== null && "codes" in c && "categories" in c;
}
function isNullableCol(c: ColumnData): c is NullableArray {
  return typeof c === "object" && c !== null && "values" in c && "mask" in c && !("codes" in c);
}

/** TypedArray → {DuckDB type, per-row appender}, mirroring `arrowTypeToDuckDB`. */
function numericSpec(v: ArrayLike<unknown>): { type: string; append: CellAppender } | null {
  if (v instanceof Float32Array) return { type: "FLOAT", append: (a, r) => a.appendFloat(v[r]) };
  if (v instanceof Float64Array) return { type: "DOUBLE", append: (a, r) => a.appendDouble(v[r]) };
  if (v instanceof Int8Array) return { type: "TINYINT", append: (a, r) => a.appendTinyInt(v[r]) };
  if (v instanceof Int16Array) return { type: "SMALLINT", append: (a, r) => a.appendSmallInt(v[r]) };
  if (v instanceof Int32Array) return { type: "INTEGER", append: (a, r) => a.appendInteger(v[r]) };
  if (v instanceof BigInt64Array) return { type: "BIGINT", append: (a, r) => a.appendBigInt(v[r]) };
  if (v instanceof Uint8Array) return { type: "UTINYINT", append: (a, r) => a.appendUTinyInt(v[r]) };
  if (v instanceof Uint16Array) return { type: "USMALLINT", append: (a, r) => a.appendUSmallInt(v[r]) };
  if (v instanceof Uint32Array) return { type: "UINTEGER", append: (a, r) => a.appendUInteger(v[r]) };
  if (v instanceof BigUint64Array) return { type: "DOUBLE", append: (a, r) => a.appendDouble(Number(v[r])) };
  return null;
}

/** Resolve a source column to its DuckDB type + a per-row appender closure. */
function colSpec(col: ColumnData): { type: string; append: CellAppender } {
  if (isCategoricalCol(col)) {
    const { codes, categories } = col;
    return {
      type: "VARCHAR",
      append: (a, r) => {
        const c = codes[r];
        if (c < 0) a.appendNull();
        else a.appendVarchar(String(categories[c]));
      },
    };
  }
  if (isNullableCol(col)) {
    const { values, mask } = col;
    const vals = values as ArrayLike<unknown>;
    // String-or-plain-array first, then bool (Uint8), then numeric — matches
    // the order in `convertNullable` so types/values agree with the Arrow path.
    if (typeof vals[0] === "string" || Array.isArray(values)) {
      return { type: "VARCHAR", append: (a, r) => (mask[r] ? a.appendNull() : a.appendVarchar(String(vals[r]))) };
    }
    if (values instanceof Uint8Array) {
      return { type: "BOOLEAN", append: (a, r) => (mask[r] ? a.appendNull() : a.appendBoolean(values[r] !== 0)) };
    }
    const num = numericSpec(vals);
    if (num) return { type: num.type, append: (a, r) => (mask[r] ? a.appendNull() : num.append(a, r)) };
    return {
      type: "DOUBLE",
      append: (a, r) => (mask[r] ? a.appendNull() : a.appendDouble(Number(vals[r]))),
    };
  }
  // Plain array → VARCHAR, stringified (mirrors convertColumn's `utf8()` for
  // Array.isArray, which stringifies even booleans → "true"/"false"). Typed as
  // string[] but runtime may hold booleans, so the String() is load-bearing.
  if (Array.isArray(col)) {
    const arr = col as unknown as unknown[];
    return {
      type: "VARCHAR",
      append: (a, r) => {
        const v = arr[r];
        if (v == null) a.appendNull();
        else a.appendVarchar(stringifyPrimitive(v));
      },
    };
  }
  const num = numericSpec(col);
  if (num) return num;
  // Non-Array iterable (e.g. zarrita BoolArray): convertColumn detects boolean →
  // bool(), else undefined → VARCHAR. Mirror without Array.from (stay streaming).
  const arrLike = col as unknown as ArrayLike<unknown>;
  if (typeof arrLike[0] === "boolean") {
    return {
      type: "BOOLEAN",
      append: (a, r) => {
        const v = arrLike[r];
        if (v == null) a.appendNull();
        else a.appendBoolean(Boolean(v));
      },
    };
  }
  return { type: "VARCHAR", append: (a, r) => a.appendVarchar(stringifyPrimitive(arrLike[r])) };
}

/**
 * `_index` is the obs/var index, which `toArrowTable` prepends as the first
 * data column. The streaming path must emit it too (sourced from `df.index`)
 * or obs_base's column set diverges from the Arrow path.
 */
const INDEX_COL = "_index";

/** A DF's columns including the prepended `_index`, in `toArrowTable` order. */
function getCol(df: LazyDataFrame, name: string): ColumnData | undefined {
  if (name === INDEX_COL) return df.index as unknown as ColumnData;
  return df.getColumn(name);
}

function unionSourceColumns(dfs: readonly LazyDataFrame[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [INDEX_COL];
  for (const df of dfs) {
    for (const n of df.columns) {
      if (seen.has(n)) continue;
      seen.add(n);
      out.push(n);
    }
  }
  return out;
}

/**
 * Drop-in streaming alternative to `ingestDataFrames` — identical schema/union
 * semantics (incl. the prepended `_index` column), but never materializes an
 * Arrow Table. Peak JS allocation is the source columns (already decoded) plus
 * one row's worth of appended values. Verified result-identical by bench/verify.ts.
 */
export async function ingestDataFramesStreaming(
  conn: DuckDBConnection,
  tableName: string,
  dfs: readonly LazyDataFrame[],
  options: IngestOptions = {},
): Promise<readonly string[]> {
  if (dfs.length === 0) throw new Error(`ingestDataFramesStreaming: no DataFrames for table "${tableName}"`);

  const columnOrder = options.columnOrder ?? unionSourceColumns(dfs);

  // First DF to carry a column wins its DuckDB type.
  const colType = new Map<string, string>();
  for (const df of dfs) {
    for (const name of columnOrder) {
      if (colType.has(name)) continue;
      const col = getCol(df, name);
      if (col) colType.set(name, colSpec(col).type);
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
  for (const name of columnOrder) colDefs.push(`"${name}" ${colType.get(name) ?? "VARCHAR"}`);
  await conn.run(`CREATE TABLE ${tableName} (${colDefs.join(", ")})`);

  let globalIndex = 0;
  for (let d = 0; d < dfs.length; d++) {
    const df = dfs[d];
    const datasetName = datasetNames?.[d];
    const appenders: (CellAppender | null)[] = columnOrder.map((name) => {
      const col = getCol(df, name);
      return col ? colSpec(col).append : null;
    });
    const idx = df.index;
    const n = df.length;
    const appender = await conn.createAppender(tableName);
    for (let r = 0; r < n; r++) {
      if (axis) appender.appendInteger(globalIndex++);
      if (includeName) appender.appendVarchar(String(idx[r] ?? ""));
      if (hasDatasetCol) appender.appendVarchar(datasetName ?? "");
      for (let c = 0; c < appenders.length; c++) {
        const ap = appenders[c];
        if (ap === null) appender.appendNull();
        else ap(appender, r);
      }
      appender.endRow();
    }
    appender.closeSync();
  }
  return columnOrder;
}
