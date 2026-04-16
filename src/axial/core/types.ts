/**
 * Core types for axial — labeled N-D arrays for scientific computing.
 *
 * Modern TS features used:
 * - Symbol.asyncDispose for automatic resource cleanup
 * - Iterator helpers (.map/.filter/.take on iterators)
 */

export type DimName = string;

// ---------------------------------------------------------------------------
// Dtype & TypedArray mapping
// ---------------------------------------------------------------------------

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

export type TypedArrayFor<D extends Dtype> = D extends "int8"
  ? Int8Array
  : D extends "int16"
    ? Int16Array
    : D extends "int32"
      ? Int32Array
      : D extends "int64"
        ? BigInt64Array
        : D extends "uint8"
          ? Uint8Array
          : D extends "uint16"
            ? Uint16Array
            : D extends "uint32"
              ? Uint32Array
              : D extends "uint64"
                ? BigUint64Array
                : D extends "float32"
                  ? Float32Array
                  : D extends "float64"
                    ? Float64Array
                    : D extends "bool"
                      ? Uint8Array
                      : never;

// ---------------------------------------------------------------------------
// Selector types (for .sel / .isel)
// ---------------------------------------------------------------------------

export type Scalar = number | string | bigint | boolean;

export interface Slice {
  start?: number;
  stop?: number;
  step?: number;
}

export function slice(start?: number, stop?: number, step?: number): Slice {
  return { start, stop, step };
}

export type IndexSelector = number | Slice | number[];
export type LabelSelector = Scalar | Slice | Scalar[];

// ---------------------------------------------------------------------------
// Coordinate types — iterable by design
// ---------------------------------------------------------------------------

export interface CoordArray {
  readonly dim: DimName;
  readonly values: ArrayLike<Scalar>;
  readonly dtype: Dtype;
  readonly attrs: Record<string, unknown>;
  readonly length: number;

  indexOf(label: Scalar): number;
  labelSlice(start: Scalar, stop: Scalar): Slice;

  /** Iterate over coordinate values. Supports iterator helpers (.map, .filter, .take). */
  [Symbol.iterator](): Iterator<Scalar>;
}

export interface CoordSet extends Iterable<CoordArray> {
  get(dim: DimName): CoordArray | undefined;
  has(dim: DimName): boolean;
  dims(): DimName[];
  readonly size: number;

  /** Iterate over all CoordArrays. Supports iterator helpers. */
  [Symbol.iterator](): Iterator<CoordArray>;
}

// ---------------------------------------------------------------------------
// DataArray — labeled N-D array (read-only, disposable)
// ---------------------------------------------------------------------------

export interface DataArray<D extends Dtype = Dtype> extends AsyncDisposable {
  readonly name: string | undefined;
  readonly dims: readonly DimName[];
  readonly shape: readonly number[];
  readonly dtype: D;
  readonly coords: CoordSet;
  readonly attrs: Record<string, unknown>;

  sel(labels: Record<DimName, LabelSelector>): LazyDataArray<D>;
  isel(indices: Record<DimName, IndexSelector>): LazyDataArray<D>;
  compute(): Promise<MaterializedDataArray<D>>;

  /** Release any cached chunks / resources. */
  [Symbol.asyncDispose](): Promise<void>;
}

export interface MaterializedDataArray<D extends Dtype = Dtype> extends DataArray<D> {
  readonly data: TypedArrayFor<D>;
}

export interface LazyDataArray<D extends Dtype = Dtype> extends DataArray<D> {
  mean(dim: DimName): LazyDataArray<D>;
  sum(dim: DimName): LazyDataArray<D>;
  min(dim: DimName): LazyDataArray<D>;
  max(dim: DimName): LazyDataArray<D>;
  add(other: DataArray): LazyDataArray<D>;
  mul(other: DataArray): LazyDataArray<D>;
  sub(other: DataArray): LazyDataArray<D>;
  div(other: DataArray): LazyDataArray<D>;
  where(pred: (val: number) => boolean): LazyDataArray<D>;
}

// ---------------------------------------------------------------------------
// Sparse arrays (AnnData CSR/CSC)
// ---------------------------------------------------------------------------

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

  /** Iterate rows as sparse vectors. Supports iterator helpers. */
  rows(): Iterator<{
    index: number;
    indices: Int32Array;
    values: Float32Array | Float64Array;
  }>;
}

// ---------------------------------------------------------------------------
// AnnData encoding types
// ---------------------------------------------------------------------------

export type EncodingType =
  | "anndata"
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
  | "null"
  | "MuData";

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
  /** Iterate rows as objects. Supports iterator helpers (.filter, .take, etc). */
  [Symbol.iterator](): Iterator<Record<string, Scalar | null>>;
}

// ---------------------------------------------------------------------------
// Dataset — collection of DataArrays (disposable)
// ---------------------------------------------------------------------------

export interface Dataset extends AsyncDisposable {
  readonly data_vars: ReadonlyMap<string, DataArray>;
  readonly coords: CoordSet;
  readonly attrs: Record<string, unknown>;

  [Symbol.asyncDispose](): Promise<void>;
}

// ---------------------------------------------------------------------------
// DataTree — hierarchical dataset (disposable, iterable)
// ---------------------------------------------------------------------------

export interface DataTree extends AsyncDisposable {
  readonly name: string;
  readonly dataset: Dataset | undefined;
  readonly children: ReadonlyMap<string, DataTree>;
  readonly attrs: Record<string, unknown>;
  readonly parent: DataTree | undefined;

  get(path: string): DataTree | undefined;
  paths(): string[];
  datasets(): Map<string, Dataset>;

  /** Iterate child nodes. Supports iterator helpers. */
  [Symbol.iterator](): Iterator<DataTree>;

  /** Dispose all resources in the tree. Use with `await using`. */
  [Symbol.asyncDispose](): Promise<void>;
}

// ---------------------------------------------------------------------------
// MultimodalDataset (MuData) — extends DataTree
// ---------------------------------------------------------------------------

export interface MultimodalDataset extends DataTree {
  readonly mod: ReadonlyMap<string, Dataset>;
  readonly obs: AnnDataFrame;
  readonly var: AnnDataFrame;
  readonly obsmap: ReadonlyMap<string, Int32Array>;
  readonly varmap: ReadonlyMap<string, Int32Array>;
}

// ---------------------------------------------------------------------------
// Structural type for Zarr group-like objects
// ---------------------------------------------------------------------------

export interface ZarrGroupLike {
  readonly attrs: Record<string, unknown>;
  resolve(path: string): unknown;
}

// ---------------------------------------------------------------------------
// Convention parser interface
// ---------------------------------------------------------------------------

export interface Convention {
  readonly name: string;
  detect(rootAttrs: Record<string, unknown>): boolean;
  parse(group: ZarrGroupLike, storePath?: string): Promise<DataTree>;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface AxialConfig {
  /** Max parallel chunk fetches. Default: 6 */
  concurrency: number;
  /** Max memory budget in bytes for chunk cache. Default: 512MB */
  maxCacheBytes: number;
}

export const DEFAULT_CONFIG: AxialConfig = {
  concurrency: 6,
  maxCacheBytes: 512 * 1024 * 1024,
};
