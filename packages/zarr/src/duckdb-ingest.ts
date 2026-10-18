/**
 * Columnar DuckDB writes: `appendColumns` fills `DuckDBDataChunk`s straight
 * from typed arrays and appends them; every table writer (obs_base, var_base,
 * var and annotation columns) goes through it.
 *
 * Shared between obs_base and var_base paths. Single-dataset: appends every
 * row as-is. Multi-dataset union: `_dataset` tags each row with its frame's
 * name.
 */

import { BoolArray } from "zarrita";
import { DuckDBDataChunk, DuckDBTypeId } from "@duckdb/node-api";
import type { DuckDBConnection, DuckDBVector } from "@duckdb/node-api";
import type { LazyDataFrame } from "./data-frame.ts";
import { readDataFrameBatches } from "./readers.ts";
import type { CategoricalArray, ColumnData, NullableArray } from "./types.ts";

type FixedWidthArray =
  | Float32Array
  | Float64Array
  | Int8Array
  | Int16Array
  | Int32Array
  | BigInt64Array
  | Uint8Array
  | Uint16Array
  | Uint32Array;

/** One table column for `appendColumns`, in table column order. */
export type AppendColumn = { name: string; type: string } &
  /** Copied into DuckDB vectors as-is (BOOLEAN takes 0/1 bytes). A truthy `nulls[row]` is NULL. */
  (
    | { values: FixedWidthArray; nulls?: ArrayLike<unknown> }
    /** One value per row, for VARCHAR and anything without a fixed-width layout. null is NULL. */
    | { get: (row: number) => string | number | boolean | null }
  );

/** DuckDB's STANDARD_VECTOR_SIZE: the most rows one data chunk holds. */
const VECTOR_SIZE = 2048;

/**
 * ponytail: node-api 1.5.6 keeps a fixed-width vector's rows in a private
 * buffer (`items`, or `dataView` for BOOLEAN) that `flush()` copies into
 * DuckDB. Filling it with one `TypedArray.set` is a memcpy: 1.5× faster than
 * `setItem` per row on 1M rows. Re-check the field names on node-api upgrades.
 */
function vectorBuffer(vector: DuckDBVector): { set(values: ArrayLike<number | bigint>): void } {
  const raw = vector as unknown as { items?: FixedWidthArray; dataView?: DataView };
  if (raw.items) return raw.items;
  if (raw.dataView && vector.type.typeId === DuckDBTypeId.BOOLEAN) {
    return new Uint8Array(raw.dataView.buffer, raw.dataView.byteOffset, raw.dataView.byteLength);
  }
  throw new Error(`appendColumns: ${vector.type.toString()} has no fixed-width layout; pass \`get\``);
}

/**
 * Append `rows` rows to `table` (created first with `create`) from `columns`,
 * which cover every table column in order. One `DuckDBDataChunk` per 2048
 * rows: fixed-width values are copied in, `get` columns go through `setItem`.
 */
export async function appendColumns(
  conn: DuckDBConnection,
  table: string,
  rows: number,
  columns: readonly AppendColumn[],
  options: { create?: boolean } = {},
): Promise<void> {
  if (options.create) {
    const defs = columns.map((c) => `"${c.name.replace(/"/g, '""')}" ${c.type}`);
    await conn.run(`CREATE OR REPLACE TABLE ${table} (${defs.join(", ")})`);
  }
  const appender = await conn.createAppender(table);
  const types = columns.map((_, i) => appender.columnType(i));
  for (let r0 = 0; r0 < rows; r0 += VECTOR_SIZE) {
    const n = Math.min(VECTOR_SIZE, rows - r0);
    const chunk = DuckDBDataChunk.create(types, n);
    for (let c = 0; c < columns.length; c++) {
      const column = columns[c];
      const vector = chunk.getColumnVector(c);
      if ("get" in column) {
        for (let i = 0; i < n; i++) vector.setItem(i, column.get(r0 + i));
      } else {
        vectorBuffer(vector).set(column.values.subarray(r0, r0 + n));
        const nulls = column.nulls;
        if (nulls) for (let i = 0; i < n; i++) if (nulls[r0 + i]) vector.setItem(i, null);
      }
      vector.flush();
    }
    appender.appendDataChunk(chunk);
  }
  appender.closeSync();
}

// ─── DataFrame → appendColumns ───────────────────────────────────────────────

export interface IngestOptions {
  /**
   * Per-DF dataset tags. When length > 1, a `_dataset` VARCHAR column is
   * prepended to the table and populated per-DF; otherwise it is skipped.
   */
  datasetNames?: readonly string[];
  /**
   * Explicit column order for the CREATE TABLE schema. Defaults to `_index`
   * plus the union of columns across `dfs` in first-seen order. Absent
   * columns in a given DF append NULL.
   */
  columnOrder?: readonly string[];
  /** Emits `__${axis}_index__ INTEGER` (global across DFs, 0..totalRows-1). */
  axis?: "obs" | "var";
  /** Emits `${axis}_name VARCHAR` from each DF's index. */
  includeNameColumn?: boolean;
}

/** The obs/var index, emitted as the first data column. */
const INDEX_COL = "_index";

function isCategorical(c: ColumnData): c is CategoricalArray {
  return typeof c === "object" && c !== null && "codes" in c && "categories" in c;
}
function isNullable(c: ColumnData): c is NullableArray {
  return typeof c === "object" && c !== null && "values" in c && "mask" in c && !("codes" in c);
}

function stringifyPrimitive(val: unknown): string {
  if (typeof val === "string") return val;
  if (typeof val === "number" || typeof val === "bigint" || typeof val === "boolean") return String(val);
  return JSON.stringify(val) ?? "";
}

/**
 * Read the DataFrame index label at row `r` as a string (the source of the
 * `{axis}_name` identity column).
 *
 * The index may be a plain `string[]`/`Int32Array` (raw `[r]` works) OR a
 * wrapper class: `SimpleNullable` (from a `nullable-string-array` index) or
 * `SimpleCategorical`: whose values are ONLY reachable via `.at(r)`; raw `[r]`
 * on the wrapper is `undefined`. That mismatch silently wrote `""` for every
 * `obs_name`, which then made `commitObsColumns` (alignment by obs_name vs the
 * on-disk `_index`) match nothing → an all-NA written-back column.
 */
function indexLabel(idx: unknown, r: number): string {
  const v =
    typeof idx === "object" && idx !== null && "at" in idx && typeof idx.at === "function"
      ? (idx.at as (i: number) => unknown).call(idx, r)
      : (idx as ArrayLike<unknown> | undefined)?.[r];
  return v == null ? "" : stringifyPrimitive(v);
}

const FIXED_WIDTH_TYPES: [new (n: number) => FixedWidthArray, string][] = [
  [Float32Array, "FLOAT"],
  [Float64Array, "DOUBLE"],
  [Int8Array, "TINYINT"],
  [Int16Array, "SMALLINT"],
  [Int32Array, "INTEGER"],
  [BigInt64Array, "BIGINT"],
  [Uint8Array, "UTINYINT"],
  [Uint16Array, "USMALLINT"],
  [Uint32Array, "UINTEGER"],
];

/** A typed array as a fixed-width column (BigUint64 widens to DOUBLE), or null. */
function fixedWidth(name: string, v: unknown, nulls?: Uint8Array): AppendColumn | null {
  if (v instanceof BigUint64Array) return { name, type: "DOUBLE", values: Float64Array.from(v, Number), nulls };
  const match = FIXED_WIDTH_TYPES.find(([ctor]) => v instanceof ctor);
  return match ? { name, type: match[1], values: v as FixedWidthArray, nulls } : null;
}

/**
 * A decoded source column as an `appendColumns` column: categoricals and
 * strings → VARCHAR, bool arrays → BOOLEAN, typed arrays → their DuckDB type,
 * nullable encodings carry their mask as NULLs.
 */
function sourceColumn(name: string, col: ColumnData): AppendColumn {
  if (isCategorical(col)) {
    const { codes, categories } = col;
    return { name, type: "VARCHAR", get: (r) => (codes[r] < 0 ? null : String(categories[codes[r]])) };
  }
  if (isNullable(col)) {
    const { values, mask } = col;
    if (values instanceof BoolArray) {
      // zarrita's bool arrays wrap 0/1 bytes, the same bytes DuckDB BOOLEAN takes.
      return {
        name,
        type: "BOOLEAN",
        values: new Uint8Array(values.buffer, values.byteOffset, values.length),
        nulls: mask,
      };
    }
    if (typeof values[0] === "string" || Array.isArray(values)) {
      return { name, type: "VARCHAR", get: (r) => (mask[r] ? null : String(values[r])) };
    }
    if (values instanceof Uint8Array) return { name, type: "BOOLEAN", get: (r) => (mask[r] ? null : values[r] !== 0) };
    return (
      fixedWidth(name, values, mask) ?? {
        name,
        type: "DOUBLE",
        values: Float64Array.from({ length: mask.length }, (_, r) => Number(values[r])),
        nulls: mask,
      }
    );
  }
  if (col instanceof BoolArray) {
    return { name, type: "BOOLEAN", values: new Uint8Array(col.buffer, col.byteOffset, col.length) };
  }
  if (Array.isArray(col)) {
    // Stringified even when the array holds numbers or booleans.
    const arr = col as unknown[];
    return { name, type: "VARCHAR", get: (r) => (arr[r] == null ? null : stringifyPrimitive(arr[r])) };
  }
  const fixed = fixedWidth(name, col);
  if (fixed) return fixed;
  // Other zarrita array-likes (e.g. UnicodeStringArray) are only iterable.
  const arr = Array.from(col as Iterable<unknown>);
  if (typeof arr[0] === "boolean") return { name, type: "BOOLEAN", get: (r) => (arr[r] == null ? null : !!arr[r]) };
  return sourceColumn(name, arr as unknown as ColumnData);
}

/** Rows of one DataFrame (or one window of it). */
interface Frame {
  index: unknown;
  length: number;
  column(name: string): ColumnData | undefined;
}

/** A frame's table columns: identity columns, then `names` (NULL where the frame lacks one). */
function frameColumns(
  frame: Frame,
  names: readonly string[],
  types: ReadonlyMap<string, string>,
  firstRow: number,
  options: IngestOptions,
  datasetName?: string,
): AppendColumn[] {
  const columns: AppendColumn[] = [];
  const { axis } = options;
  if (axis) {
    const index = new Int32Array(frame.length);
    for (let r = 0; r < index.length; r++) index[r] = firstRow + r;
    columns.push({ name: `__${axis}_index__`, type: "INTEGER", values: index });
    if (options.includeNameColumn) {
      columns.push({ name: `${axis}_name`, type: "VARCHAR", get: (r) => indexLabel(frame.index, r) });
    }
  }
  if (datasetName !== undefined) columns.push({ name: "_dataset", type: "VARCHAR", get: () => datasetName });
  for (const name of names) {
    const col = name === INDEX_COL ? (frame.index as ColumnData) : frame.column(name);
    columns.push(col ? sourceColumn(name, col) : { name, type: types.get(name) ?? "VARCHAR", get: () => null });
  }
  return columns;
}

/**
 * Append a frame into `table`, created from the first frame's columns. A
 * later frame whose column types differ (first frame wins) is staged in its
 * own types and inserted, so DuckDB casts it.
 */
async function appendFrame(
  conn: DuckDBConnection,
  table: string,
  tableTypes: readonly string[] | null,
  rows: number,
  columns: AppendColumn[],
): Promise<readonly string[]> {
  if (tableTypes === null) {
    await appendColumns(conn, table, rows, columns, { create: true });
    return columns.map((c) => c.type);
  }
  if (columns.every((c, i) => c.type === tableTypes[i])) {
    await appendColumns(conn, table, rows, columns);
  } else {
    await appendColumns(conn, "__ingest_stage", rows, columns, { create: true });
    await conn.run(`INSERT INTO ${table} SELECT * FROM __ingest_stage; DROP TABLE __ingest_stage`);
  }
  return tableTypes;
}

/** Single-DF convenience. Delegates to `ingestDataFrames`. */
export function ingestDataFrame(
  conn: DuckDBConnection,
  tableName: string,
  df: LazyDataFrame,
  options: Omit<IngestOptions, "datasetNames"> = {},
): Promise<readonly string[]> {
  return ingestDataFrames(conn, tableName, [df], options);
}

/**
 * CREATE TABLE + append one or more DataFrames as a union.
 *
 * Multi-DF semantics:
 *   - Column schema is `_index` plus the UNION of `dfs[*].columns`
 *     (first-seen order).
 *   - Per-column type resolution: first DF to carry a column wins the type;
 *     later DFs missing it append NULL.
 *   - `__${axis}_index__` is GLOBAL (0..totalRows-1), not per-DF.
 *   - `_dataset` column only exists when `datasetNames.length > 1`.
 */
export async function ingestDataFrames(
  conn: DuckDBConnection,
  tableName: string,
  dfs: readonly LazyDataFrame[],
  options: IngestOptions = {},
): Promise<readonly string[]> {
  if (dfs.length === 0) throw new Error(`ingestDataFrames: no DataFrames for table "${tableName}"`);
  const names = options.columnOrder ?? unionSourceColumns(dfs);
  const types = new Map<string, string>();
  for (const df of dfs) {
    for (const name of names) {
      const col = name === INDEX_COL ? (df.index as unknown as ColumnData) : df.getColumn(name);
      if (col && !types.has(name)) types.set(name, sourceColumn(name, col).type);
    }
  }
  const tags = options.datasetNames !== undefined && options.datasetNames.length > 1 ? options.datasetNames : null;

  let tableTypes: readonly string[] | null = null;
  let firstRow = 0;
  for (let d = 0; d < dfs.length; d++) {
    const df = dfs[d];
    const frame: Frame = { index: df.index, length: df.length, column: (name) => df.getColumn(name) };
    const columns = frameColumns(frame, names, types, firstRow, options, tags?.[d]);
    tableTypes = await appendFrame(conn, tableName, tableTypes, df.length, columns);
    firstRow += df.length;
  }
  return names;
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
 * Chunked ingest: reads the zarr DataFrame in row-windows
 * (`readDataFrameBatches`) and appends each batch, so peak JS allocation is
 * O(batch) not O(whole obs). Single-DF / AnnData layout only (no `_dataset`
 * union). Same `_index`-prepended schema + null semantics as `ingestDataFrames`.
 */
export async function ingestDataFrameChunked(
  conn: DuckDBConnection,
  tableName: string,
  store: Parameters<typeof readDataFrameBatches>[0],
  groupPath: string,
  options: Pick<IngestOptions, "axis" | "includeNameColumn"> = {},
  batchSize = 250_000,
): Promise<readonly string[]> {
  let names: string[] = [];
  let tableTypes: readonly string[] | null = null;
  let firstRow = 0;
  for await (const batch of readDataFrameBatches(store, groupPath, batchSize)) {
    if (tableTypes === null) names = [INDEX_COL, ...batch.columns.keys()];
    const frame: Frame = { index: batch.index, length: batch.n, column: (name) => batch.columns.get(name) };
    const columns = frameColumns(frame, names, new Map(), firstRow, options);
    tableTypes = await appendFrame(conn, tableName, tableTypes, batch.n, columns);
    firstRow += batch.n;
  }
  if (tableTypes === null) throw new Error(`ingestDataFrameChunked: "${groupPath}" yielded no rows`);
  return names;
}
