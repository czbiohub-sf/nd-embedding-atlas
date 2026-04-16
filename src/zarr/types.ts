/**
 * Core types for the vendored zarr reader.
 *
 * Originally the public type surface of a planned standalone library ("axial"); now
 * trimmed to exactly what nd-embedding-atlas consumes — the AnnData/MuData/OME-Zarr
 * parsing pipeline plus the Arrow-conversion surface exposed to the server.
 */

// ---------------------------------------------------------------------------
// Primitive aliases
// ---------------------------------------------------------------------------

export type DimName = string;

/** Scalar values that can appear in a coord array, categorical, or nullable column. */
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

// ---------------------------------------------------------------------------
// Slice — used by CoordArray.labelSlice
// ---------------------------------------------------------------------------

export interface Slice {
  readonly start?: number;
  readonly stop?: number;
  readonly step?: number;
}

// ---------------------------------------------------------------------------
// Coordinate types
// ---------------------------------------------------------------------------

export interface CoordArray {
  readonly dim: DimName;
  readonly values: ArrayLike<Scalar>;
  readonly dtype: Dtype;
  readonly attrs: Record<string, unknown>;
  readonly length: number;

  indexOf(label: Scalar): number;
  labelSlice(start: Scalar, stop: Scalar): Slice;

  [Symbol.iterator](): Iterator<Scalar>;
}

export interface CoordSet extends Iterable<CoordArray> {
  get(dim: DimName): CoordArray | undefined;
  has(dim: DimName): boolean;
  dims(): DimName[];
  readonly size: number;

  [Symbol.iterator](): Iterator<CoordArray>;
}

// ---------------------------------------------------------------------------
// AnnData encoding types
// ---------------------------------------------------------------------------

/**
 * Discriminator tag found on `encoding-type` attrs in AnnData/MuData stores.
 * We only match the values actually encountered by our readers; unknown values
 * fall through to plain-array handling.
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

/** Sparse CSR/CSC matrix from AnnData X or layers. */
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

/** Union of all column representations inside an AnnDataFrame. */
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

export interface AnnDataFrame extends Iterable<Record<string, Scalar | null>> {
  readonly index: string[] | Int32Array;
  readonly columns: ReadonlyMap<string, ColumnData>;
  readonly columnOrder: readonly string[];
  column(name: string): ColumnData | undefined;
  [Symbol.iterator](): Iterator<Record<string, Scalar | null>>;
}

// ---------------------------------------------------------------------------
// Dataset & DataTree
// ---------------------------------------------------------------------------

/**
 * Collection of lazy data_vars + coords. Convention parsers populate this;
 * the server consumes it via `AnnDataAccessor` which treats `data_vars`
 * entries as opaque lazy handles.
 */
export interface Dataset extends AsyncDisposable {
  readonly data_vars: ReadonlyMap<string, unknown>;
  readonly coords: CoordSet;
  readonly attrs: Record<string, unknown>;

  [Symbol.asyncDispose](): Promise<void>;
}

/** Hierarchical dataset (mirrors xarray's DataTree). */
export interface DataTree extends AsyncDisposable {
  readonly name: string;
  readonly dataset: Dataset | undefined;
  readonly children: ReadonlyMap<string, DataTree>;
  readonly attrs: Record<string, unknown>;
  readonly parent: DataTree | undefined;

  get(path: string): DataTree | undefined;
  paths(): string[];
  datasets(): Map<string, Dataset>;

  [Symbol.iterator](): Iterator<DataTree>;
  [Symbol.asyncDispose](): Promise<void>;
}

// ---------------------------------------------------------------------------
// Convention parser
// ---------------------------------------------------------------------------

/** Registered convention names. Each `Convention.name` is one of these literals. */
export type ConventionName = "ome-zarr" | "anndata" | "mudata" | "xarray";

/**
 * Implemented by `detectOmeZarr`, `detectAnnData`, `detectMuData`, `detectXarray`.
 * `group` is a zarrita `Group` — we keep it structural to avoid a hard type
 * dependency on zarrita internals at the type layer.
 */
export interface Convention {
  readonly name: ConventionName;
  detect(rootAttrs: Record<string, unknown>): boolean;
  parse(group: unknown, storePath?: string): Promise<DataTree>;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface ZarrConfig {
  /** Max parallel chunk fetches. Default: 6 */
  concurrency: number;
  /** Max memory budget in bytes for chunk cache. Default: 512MB */
  maxCacheBytes: number;
}
