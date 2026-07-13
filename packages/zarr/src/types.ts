/**
 * Core types for the vendored zarr reader.
 *
 * Trimmed to exactly what nd-embedding-atlas consumes:
 *   - AnnData / MuData / OME-Zarr detection + parsed-store results
 *   - Column-level value types for obs/var DataFrames
 *   - Sparse matrix shape for X / layers
 *
 * Consumers branch on `ParsedStore.kind` for convention-specific handling.
 */

// ─── Primitive aliases ──────────────────────────────────────────────────────

/** Scalar values appearing inside DataFrame columns. */
export type Scalar = number | string | bigint | boolean;

/** Zarr dtypes we round-trip through this reader. */
export type Dtype =
  | "int8"
  | "int16"
  | "int32"
  | "int64"
  | "uint8"
  | "uint16"
  | "uint32"
  | "uint64"
  | "float32"
  | "float64"
  | "bool"
  | "string"
  | "object";

// ─── AnnData encoding types ─────────────────────────────────────────────────

/**
 * `encoding-type` attrs on AnnData / MuData stores. We match only the values
 * actually encountered; unknown values fall through to plain-array handling.
 */
export type EncodingType =
  | "anndata"
  | "MuData"
  | "dataframe"
  | "categorical"
  | "csr_matrix"
  | "csc_matrix"
  | "nullable-integer"
  | "nullable-boolean"
  | "nullable-string"
  | "nullable-string-array"
  | "string-array"
  | "numeric-scalar"
  | "string"
  | "array"
  | "null";

export interface CategoricalArray extends Iterable<Scalar | null> {
  readonly categories: readonly Scalar[];
  readonly codes: Int8Array | Int16Array | Int32Array;
  readonly ordered: boolean;
  readonly length: number;
  at(i: number): Scalar | null;
  toArray(): (Scalar | null)[];
  [Symbol.iterator](): Iterator<Scalar | null>;
}

export interface NullableArray extends Iterable<Scalar | null> {
  readonly values: ArrayLike<Scalar>;
  readonly mask: Uint8Array;
  readonly length: number;
  at(i: number): Scalar | null;
  [Symbol.iterator](): Iterator<Scalar | null>;
}

/** CSR / CSC sparse matrix (X, layers). */
export interface SparseArray {
  readonly shape: readonly [number, number];
  readonly format: "csr" | "csc";
  readonly data: Float32Array | Float64Array;
  readonly indices: Int32Array;
  readonly indptr: Int32Array;
  readonly dtype: Dtype;
  readonly nnz: number;

  row(i: number): { indices: Int32Array; values: Float32Array | Float64Array };
  col(j: number): { indices: Int32Array; values: Float32Array | Float64Array };
  sliceRows(start: number, end: number): SparseArray;

  rows(): Iterator<{
    index: number;
    indices: Int32Array;
    values: Float32Array | Float64Array;
  }>;
}

/** Every representation a DataFrame column can take. */
export type ColumnData =
  | Float32Array
  | Float64Array
  | Int8Array
  | Int16Array
  | Int32Array
  | BigInt64Array
  | Uint8Array
  | Uint16Array
  | Uint32Array
  | BigUint64Array
  | string[]
  | CategoricalArray
  | NullableArray;

/**
 * Column-oriented DataFrame shape — the natural output of `readDataFrame`.
 *
 * Not exported as the public API — consumers see `DataFrame` from
 * `./data-frame.ts` which wraps this with a stable indexed-access surface.
 */
export interface AnnDataFrame extends Iterable<Record<string, Scalar | null>> {
  readonly index: string[] | Int32Array;
  readonly columns: ReadonlyMap<string, ColumnData>;
  readonly columnOrder: readonly string[];
  column(name: string): ColumnData | undefined;
  [Symbol.iterator](): Iterator<Record<string, Scalar | null>>;
}

// ─── ParsedStore — discriminated result of open() ───────────────────────────

/** Opaque zarrita Group handle. Parsers hold it; public classes don't expose it. */
export type ZarrGroupHandle = unknown;

export interface ParsedAnnData {
  readonly kind: "anndata";
  readonly obs: AnnDataFrame | undefined;
  readonly var: AnnDataFrame | undefined;
  readonly attrs: Record<string, unknown>;
  readonly group: ZarrGroupHandle;
  readonly storePath: string | undefined;
}

export interface ParsedMuData {
  readonly kind: "mudata";
  readonly obs: AnnDataFrame | undefined;
  readonly var: AnnDataFrame | undefined;
  readonly attrs: Record<string, unknown>;
  readonly group: ZarrGroupHandle;
  readonly storePath: string | undefined;
  readonly modalities: ReadonlyMap<string, ParsedAnnData>;
  readonly obsmap: ReadonlyMap<string, Int32Array | Uint32Array>;
}

export interface ParsedOmeZarr {
  readonly kind: "ome-zarr";
  readonly attrs: Record<string, unknown>;
  readonly group: ZarrGroupHandle;
  readonly storePath: string | undefined;
  /** `multiscales[0].axes` from root `.zattrs`. */
  readonly multiscales: readonly unknown[];
}

export type ParsedStore = ParsedAnnData | ParsedMuData | ParsedOmeZarr;
