/**
 * DataFrame: obs/var surface for the AnnData class.
 *
 * Wraps the existing `AnnDataFrame` (column-major map) and exposes a stable
 * tabular surface. `toArrow()` is the hot path; downstream consumers always
 * take the Arrow Table and hand it to DuckDB's Appender.
 *
 * Also contains the AnnDataFrame → Arrow conversion (previously a
 * separate `to-arrow.ts`). Kept as a named export `toArrowTable` for
 * direct callers; `LazyDataFrame.toArrow()` is the supported surface.
 */

import {
  int8,
  int16,
  int32,
  int64,
  float32,
  float64,
  uint8,
  uint16,
  uint32,
  utf8,
  bool,
  tableFromArrays,
} from "@uwdata/flechette";
import type { DataType, Table as ArrowTable } from "@uwdata/flechette";
import type { AnnDataFrame, CategoricalArray, ColumnData, NullableArray } from "./types.ts";

/**
 * Lazy adapter over `AnnDataFrame`. No data copy; `toArrow()` builds the
 * Arrow Table on demand (today it's materialized by `toArrowTable`; can swap
 * for a streaming builder later without breaking callers).
 */
export class LazyDataFrame {
  private readonly _source: AnnDataFrame;
  private _arrow: ArrowTable | undefined;
  readonly indexName: string;

  constructor(source: AnnDataFrame, indexName = "_index") {
    this._source = source;
    this.indexName = indexName;
  }

  get length(): number {
    const idx = this._source.index;
    return Array.isArray(idx) ? idx.length : idx.length;
  }

  get columns(): readonly string[] {
    return this._source.columnOrder;
  }

  get index(): readonly string[] | Int32Array {
    return this._source.index;
  }

  getColumn(name: string): ColumnData | undefined {
    return this._source.column(name);
  }

  toArrow(): ArrowTable {
    this._arrow ??= toArrowTable(this._source) as unknown as ArrowTable;
    return this._arrow;
  }

  /** Underlying AnnDataFrame: escape hatch for consumers that still need it. */
  get source(): AnnDataFrame {
    return this._source;
  }
}

// ─── AnnDataFrame → Arrow conversion ───────────────────────────────────────

// flechette's tableFromArrays accepts `any[] | TypedArray` at runtime; we keep the
// Arrow conversion helpers retain unknown data until the build callsite narrows it.
type ArrowColumnConversion = { col: unknown; type: DataType | undefined };

// The shape tableFromArrays expects (union of TypedArray constructors + any[]).
type FlechetteArray =
  | Uint8Array
  | Uint16Array
  | Uint32Array
  | Int8Array
  | Int16Array
  | Int32Array
  | Float32Array
  | Float64Array
  | BigInt64Array
  | BigUint64Array
  | unknown[];

/**
 * Convert an AnnDataFrame (from AnnData obs/var) to a flechette Arrow Table.
 *
 * @example
 * ```ts
 * import { open, toArrowTable } from "@ndea/zarr";
 *
 * const parsedStore = await open("./pbmc.zarr");
 * if (parsedStore.kind !== "anndata" || !parsedStore.obs) throw new Error("AnnData obs is unavailable");
 * const obsTable = toArrowTable(parsedStore.obs);
 * // obsTable is now a flechette Table: Arrow IPC compatible
 * ```
 */
export function toArrowTable(df: AnnDataFrame) {
  const arrays: Record<string, FlechetteArray> = {};
  const types: Record<string, DataType> = {};

  // Convert index
  const { col: indexCol, type: indexType } = convertColumn(df.index);
  arrays._index = indexCol as FlechetteArray;
  if (indexType) types._index = indexType;

  // Convert each column
  for (const name of df.columnOrder) {
    const data = df.column(name);
    if (!data) continue;
    const { col, type } = convertColumn(data);
    arrays[name] = col as FlechetteArray;
    if (type) types[name] = type;
  }

  // tableFromArrays creates proper Arrow columns (unlike tableFromColumns)
  return tableFromArrays(arrays, { types });
}

function convertColumn(data: ColumnData | string[] | Int32Array): ArrowColumnConversion {
  // CategoricalArray → Dictionary
  if (isCategorical(data)) {
    return convertCategorical(data);
  }

  // NullableArray → nullable column
  if (isNullable(data)) {
    return convertNullable(data);
  }

  // Plain array → Utf8. flechette's utf8 builder empties NON-string values (a
  // boolean obs column like `is_primary_data` became "": silent data loss), so
  // stringify first. Strings pass through unchanged; null stays null.
  if (Array.isArray(data)) {
    const arr = data as unknown as (string | number | boolean | bigint | null)[];
    const allStrings = arr.length === 0 || typeof arr[0] === "string";
    const col = allStrings ? data : arr.map((v) => (v == null ? null : String(v)));
    return { col, type: utf8() };
  }

  // BigInt64Array → Int64
  if (data instanceof BigInt64Array) {
    return { col: data, type: int64() };
  }

  if (data instanceof BigUint64Array) {
    // Arrow/flechette has no uint64. Convert to float64 to preserve values safely.
    const f64 = Float64Array.from(data, (v) => Number(v));
    return { col: f64, type: float64() };
  }

  // TypedArray → infer Arrow type
  const arrowType = typedArrayToArrowType(data);
  if (arrowType) return { col: data, type: arrowType };

  // Zarrita BoolArray or other non-standard array-like:
  // convert to plain array so flechette can handle it
  if (data && typeof data === "object" && "length" in data && Symbol.iterator in data) {
    const arr = Array.from(data as Iterable<unknown>);
    // Detect booleans
    if (typeof arr[0] === "boolean") {
      return { col: arr, type: bool() };
    }
    return { col: arr, type: undefined };
  }

  // Fallback
  return { col: data, type: undefined };
}

/**
 * Convert CategoricalArray to Arrow Dictionary column.
 * AnnData: codes (int8/16/32, -1 = null) + categories (string[])
 * Arrow: Dictionary(index_type, Utf8) with validity bitmap for nulls
 */
function convertCategorical(cat: CategoricalArray): ArrowColumnConversion {
  // Decode to plain string array: flechette will handle encoding.
  // Passing dictionary() type with a decoded string[] is incoherent,
  // so we use utf8() and let flechette build its own dictionary if needed.
  const categories = cat.categories.map(String);
  const decoded: (string | null)[] = [];
  for (let i = 0; i < cat.codes.length; i++) {
    const code = cat.codes[i];
    decoded.push(code === -1 ? null : categories[code]);
  }
  return { col: decoded, type: utf8() };
}

/**
 * Convert NullableArray to Arrow column with validity bitmap.
 * AnnData mask: Uint8Array where 1 = null, 0 = valid
 * Arrow validity: 1 = valid, 0 = null (inverted!)
 */
function convertNullable(na: NullableArray): ArrowColumnConversion {
  const values = na.values;
  const len = na.mask.length;

  // For string values, build array with nulls
  if (typeof values[0] === "string" || Array.isArray(values)) {
    const result: (string | null)[] = [];
    for (let i = 0; i < len; i++) {
      result.push(na.mask[i] ? null : String(values[i]));
    }
    return { col: result, type: utf8() };
  }

  // For numeric values, build array with nulls
  // flechette accepts arrays with null for nullable columns
  const result: (number | bigint | null)[] = [];
  for (let i = 0; i < len; i++) {
    result.push(na.mask[i] ? null : (values[i] as number | bigint));
  }

  // Infer type from underlying values (Uint8Array maps to bool for nullable booleans)
  const type = values instanceof Uint8Array ? bool() : (typedArrayToArrowType(values) ?? float64());

  return { col: result, type };
}

/** Map a TypedArray to its Arrow type, or undefined if not a recognized TypedArray. */
function typedArrayToArrowType(data: unknown): DataType | undefined {
  if (data instanceof Float32Array) return float32();
  if (data instanceof Float64Array) return float64();
  if (data instanceof Int8Array) return int8();
  if (data instanceof Int16Array) return int16();
  if (data instanceof Int32Array) return int32();
  if (data instanceof BigInt64Array) return int64();
  if (data instanceof Uint8Array) return uint8();
  if (data instanceof Uint16Array) return uint16();
  if (data instanceof Uint32Array) return uint32();
  return undefined;
}

// Type guards

function isCategorical(data: unknown): data is CategoricalArray {
  return data !== null && typeof data === "object" && "codes" in data && "categories" in data && "ordered" in data;
}

function isNullable(data: unknown): data is NullableArray {
  return data !== null && typeof data === "object" && "values" in data && "mask" in data && !("codes" in data);
}
