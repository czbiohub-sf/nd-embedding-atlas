/**
 * AnnDataAccessor — lazy access to X, layers, obsm with sel/isel selection.
 *
 * Wraps the dataset returned by the AnnData parser. X and layers are loaded
 * on demand; obs/var DataFrames are already in memory from open().
 *
 * Selection model:
 *   sel()  — filter by obs/var metadata (AND semantics across columns)
 *   isel() — select by integer indices on obs and/or var axes
 *
 * Both return a new AnnDataAccessor with the selection recorded. When getX(),
 * getLayer(), or getObsm() is called, the selection is applied after loading.
 */

import * as zarr from "zarrita";
import type {
  AnnDataFrame,
  CategoricalArray,
  ColumnData,
  NullableArray,
  Scalar,
  SparseArray,
} from "./types.ts";
import { CsrCscArray } from "./sparse.ts";
import { readSparse } from "../conventions/encoding-readers.ts";

// TypedArray union for dense matrix results
type TypedArray =
  | Float32Array
  | Float64Array
  | Int8Array
  | Int16Array
  | Int32Array
  | Uint8Array
  | Uint16Array
  | Uint32Array;

/** Result type for dense arrays. */
export interface DenseResult {
  data: TypedArray;
  shape: number[];
}

/** Result type for getX / getLayer — sparse or dense. */
export type MatrixResult = SparseArray | DenseResult;

/** Extended dataset type from anndata parser. */
interface AnnDataDataset {
  data_vars: ReadonlyMap<string, any>;
  obs?: AnnDataFrame;
  var?: AnnDataFrame;
  _group?: any;
  _storePath?: string;
  attrs: Record<string, unknown>;
}

/**
 * Accessor for AnnData stores with lazy X/layer loading and sel/isel selection.
 *
 * @example
 * ```ts
 * import { open, AnnDataAccessor } from "axial";
 *
 * const tree = await open("./data.zarr");
 * const adata = AnnDataAccessor.from(tree);
 *
 * // Lazy load X
 * const X = await adata.getX();
 *
 * // Select T-cells and load their expression
 * const tcells = adata.sel({ cell_type: "T-cell" });
 * const tcellX = await tcells.getX();
 *
 * // Integer indexing
 * const subset = adata.isel({ obs: [0, 1, 2], var: [10, 20, 30] });
 * const subsetX = await subset.getX();
 * ```
 */
export class AnnDataAccessor {
  private readonly _dataset: AnnDataDataset;
  private readonly _group: any;
  private readonly _storePath: string | undefined;
  private readonly _obsIndices: number[] | null;
  private readonly _varIndices: number[] | null;

  constructor(
    dataset: AnnDataDataset,
    group?: any,
    storePath?: string,
    obsIndices?: number[] | null,
    varIndices?: number[] | null,
  ) {
    this._dataset = dataset;
    this._group = group ?? dataset._group;
    this._storePath = storePath ?? dataset._storePath;
    this._obsIndices = obsIndices ?? null;
    this._varIndices = varIndices ?? null;
  }

  /**
   * Create an AnnDataAccessor from a DataTree returned by open().
   * Works with both AnnData trees and MuData modality subtrees.
   */
  static from(treeOrDataset: any): AnnDataAccessor {
    // If it's a DataTree, grab its dataset
    const ds = treeOrDataset.dataset ?? treeOrDataset;
    return new AnnDataAccessor(ds as AnnDataDataset);
  }

  /** The obs DataFrame (already loaded). */
  get obs(): AnnDataFrame {
    const o = this._dataset.obs;
    if (!o) throw new Error("No obs DataFrame available");
    return o;
  }

  /** The var DataFrame (already loaded). */
  get var(): AnnDataFrame {
    const v = this._dataset.var;
    if (!v) throw new Error("No var DataFrame available");
    return v;
  }

  /** Current obs selection indices (null = all). */
  get obsIndices(): number[] | null {
    return this._obsIndices;
  }

  /** Current var selection indices (null = all). */
  get varIndices(): number[] | null {
    return this._varIndices;
  }

  /** Number of selected observations. */
  get nObs(): number {
    if (this._obsIndices) return this._obsIndices.length;
    const idx = this._dataset.obs?.index;
    return idx ? (Array.isArray(idx) ? idx.length : idx.length) : 0;
  }

  /** Number of selected variables. */
  get nVar(): number {
    if (this._varIndices) return this._varIndices.length;
    const idx = this._dataset.var?.index;
    return idx ? (Array.isArray(idx) ? idx.length : idx.length) : 0;
  }

  // ---------------------------------------------------------------------------
  // Lazy data loading
  // ---------------------------------------------------------------------------

  /**
   * Load the X matrix (expression data).
   * Applies any active obs/var selection.
   */
  async getX(): Promise<MatrixResult> {
    return this._loadMatrix("X");
  }

  /**
   * Load a layer by name (e.g. "raw_counts", "normalized").
   * Applies any active obs/var selection.
   */
  async getLayer(name: string): Promise<MatrixResult> {
    return this._loadMatrix(`layers/${name}`);
  }

  /**
   * Load an obsm embedding by name (e.g. "X_pca", "X_umap").
   * Returns a dense array. Applies obs selection.
   */
  async getObsm(name: string): Promise<DenseResult> {
    const path = `obsm/${name}`;
    const location = this._group.resolve(path);

    // obsm can be a plain array or a group with encoding-type: array
    let data: TypedArray;
    let shape: number[];

    try {
      // Try as group first (encoding-type: array wraps a plain zarr array)
      const grp = await zarr.open(location, { kind: "group" });
      const attrs = (grp.attrs ?? {}) as Record<string, unknown>;
      if (attrs["encoding-type"] === "array") {
        // It's still just a zarr array at the same path — re-open as array
        const arr = await zarr.open(location, { kind: "array" });
        const result = await zarr.get(arr);
        data = result.data as TypedArray;
        shape = [...arr.shape];
      } else {
        throw new Error("Not a plain array group");
      }
    } catch {
      // Open as array directly
      const arr = await zarr.open(location, { kind: "array" });
      const result = await zarr.get(arr);
      data = result.data as TypedArray;
      shape = [...arr.shape];
    }

    return this._applyDenseSelection(data, shape);
  }

  // ---------------------------------------------------------------------------
  // Selection: sel and isel
  // ---------------------------------------------------------------------------

  /**
   * Select observations by metadata values (AND across columns).
   *
   * @param query - Column name → value(s) to match. Arrays use OR within a column.
   * @returns New AnnDataAccessor with matching obs indices.
   *
   * @example
   * ```ts
   * // Single value per column (AND)
   * adata.sel({ cell_type: "T-cell", donor: "donor_1" })
   *
   * // Multiple values per column (OR within column, AND across columns)
   * adata.sel({ cell_type: ["T-cell", "B-cell"] })
   * ```
   */
  sel(query: Record<string, unknown>): AnnDataAccessor {
    const obs = this.obs;
    const nObs = Array.isArray(obs.index) ? obs.index.length : obs.index.length;

    // Start with current selection or all indices
    let candidates: number[];
    if (this._obsIndices) {
      candidates = [...this._obsIndices];
    } else {
      candidates = Array.from({ length: nObs }, (_, i) => i);
    }

    // Filter by each column in the query (AND semantics)
    for (const [colName, queryValue] of Object.entries(query)) {
      const col = obs.column(colName);
      if (!col) {
        throw new Error(
          `obs column "${colName}" not found. Available: ${obs.columnOrder.join(", ")}`,
        );
      }

      const matchValues = Array.isArray(queryValue) ? queryValue : [queryValue];
      candidates = candidates.filter((i) => {
        const cellValue = getColumnValue(col, i);
        return matchValues.some((qv) => cellValue === qv);
      });
    }

    return new AnnDataAccessor(
      this._dataset,
      this._group,
      this._storePath,
      candidates,
      this._varIndices,
    );
  }

  /**
   * Select by integer indices on obs and/or var axes.
   *
   * @param indices - obs and/or var integer index arrays.
   * @returns New AnnDataAccessor with the selection applied.
   *
   * @example
   * ```ts
   * adata.isel({ obs: [0, 1, 2] })
   * adata.isel({ var: [10, 20, 30] })
   * adata.isel({ obs: [0, 1], var: [10, 20] })
   * ```
   */
  isel(indices: { obs?: number[]; var?: number[] }): AnnDataAccessor {
    let newObs = this._obsIndices;
    let newVar = this._varIndices;

    if (indices.obs !== undefined) {
      if (this._obsIndices) {
        // Compose: indices into current selection
        newObs = indices.obs.map((i) => {
          if (i < 0 || i >= this._obsIndices!.length) {
            throw new RangeError(`obs index ${i} out of range [0, ${this._obsIndices!.length})`);
          }
          return this._obsIndices![i];
        });
      } else {
        newObs = [...indices.obs];
      }
    }

    if (indices.var !== undefined) {
      if (this._varIndices) {
        newVar = indices.var.map((i) => {
          if (i < 0 || i >= this._varIndices!.length) {
            throw new RangeError(`var index ${i} out of range [0, ${this._varIndices!.length})`);
          }
          return this._varIndices![i];
        });
      } else {
        newVar = [...indices.var];
      }
    }

    return new AnnDataAccessor(this._dataset, this._group, this._storePath, newObs, newVar);
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  /**
   * Load a matrix from a relative path (X, layers/name).
   * Handles both sparse (CSR/CSC) and dense arrays.
   */
  private async _loadMatrix(path: string): Promise<MatrixResult> {
    const location = this._group.resolve(path);

    // Try as sparse group first
    try {
      const grp = await zarr.open(location, { kind: "group" });
      const attrs = (grp.attrs ?? {}) as Record<string, unknown>;
      const encoding = attrs["encoding-type"] as string | undefined;

      if (encoding === "csr_matrix" || encoding === "csc_matrix") {
        const sparse = await readSparse(grp as any);
        return this._applySparseSelection(sparse);
      }
    } catch {
      // Not a group — try as dense array
    }

    // Dense array
    const arr = await zarr.open(location, { kind: "array" });
    const result = await zarr.get(arr);
    const data = result.data as TypedArray;
    const shape = [...arr.shape];

    return this._applyDenseSelection(data, shape);
  }

  /**
   * Apply obs/var selection to a sparse matrix.
   * For CSR: select rows by obsIndices, then filter columns by varIndices.
   * For CSC: select columns by varIndices, then filter rows by obsIndices.
   */
  private _applySparseSelection(sparse: SparseArray): SparseArray {
    if (!this._obsIndices && !this._varIndices) return sparse;

    if (sparse.format === "csr") {
      return this._selectSparseCSR(sparse);
    }
    return this._selectSparseCSC(sparse);
  }

  /** Select rows and optionally columns from a CSR matrix. */
  private _selectSparseCSR(sparse: SparseArray): SparseArray {
    const obsIdx = this._obsIndices;
    const varIdx = this._varIndices;
    const varSet = varIdx ? new Set(varIdx) : null;
    // Build a map from old column index to new column index for var selection
    const varMap = varIdx ? new Map(varIdx.map((v, i) => [v, i])) : null;
    const nCols = varIdx ? varIdx.length : sparse.shape[1];
    const rowIndices = obsIdx ?? Array.from({ length: sparse.shape[0] }, (_, i) => i);

    // Collect new sparse data
    const newIndptrArr: number[] = [0];
    const newIndicesArr: number[] = [];
    const newDataArr: number[] = [];

    for (const ri of rowIndices) {
      const rowStart = sparse.indptr[ri];
      const rowEnd = sparse.indptr[ri + 1];

      for (let p = rowStart; p < rowEnd; p++) {
        const colIdx = sparse.indices[p];
        if (varSet && !varSet.has(colIdx)) continue;
        const newCol = varMap ? varMap.get(colIdx)! : colIdx;
        newIndicesArr.push(newCol);
        newDataArr.push(sparse.data[p]);
      }
      newIndptrArr.push(newIndicesArr.length);
    }

    const DataCtor = sparse.data instanceof Float64Array ? Float64Array : Float32Array;

    return new CsrCscArray({
      shape: [rowIndices.length, nCols],
      format: "csr",
      data: new DataCtor(newDataArr),
      indices: new Int32Array(newIndicesArr),
      indptr: new Int32Array(newIndptrArr),
      dtype: sparse.dtype,
    });
  }

  /** Select columns and optionally rows from a CSC matrix. */
  private _selectSparseCSC(sparse: SparseArray): SparseArray {
    const obsIdx = this._obsIndices;
    const varIdx = this._varIndices;
    const obsSet = obsIdx ? new Set(obsIdx) : null;
    const obsMap = obsIdx ? new Map(obsIdx.map((v, i) => [v, i])) : null;
    const nRows = obsIdx ? obsIdx.length : sparse.shape[0];
    const colIndices = varIdx ?? Array.from({ length: sparse.shape[1] }, (_, i) => i);

    const newIndptrArr: number[] = [0];
    const newIndicesArr: number[] = [];
    const newDataArr: number[] = [];

    for (const ci of colIndices) {
      const colStart = sparse.indptr[ci];
      const colEnd = sparse.indptr[ci + 1];

      for (let p = colStart; p < colEnd; p++) {
        const rowIdx = sparse.indices[p];
        if (obsSet && !obsSet.has(rowIdx)) continue;
        const newRow = obsMap ? obsMap.get(rowIdx)! : rowIdx;
        newIndicesArr.push(newRow);
        newDataArr.push(sparse.data[p]);
      }
      newIndptrArr.push(newIndicesArr.length);
    }

    const DataCtor = sparse.data instanceof Float64Array ? Float64Array : Float32Array;

    return new CsrCscArray({
      shape: [nRows, colIndices.length],
      format: "csc",
      data: new DataCtor(newDataArr),
      indices: new Int32Array(newIndicesArr),
      indptr: new Int32Array(newIndptrArr),
      dtype: sparse.dtype,
    });
  }

  /**
   * Apply obs/var selection to a dense 2D array.
   * shape is [nObs, nVar] (or [nObs, nComponents] for obsm).
   */
  private _applyDenseSelection(data: TypedArray, shape: number[]): DenseResult {
    if (!this._obsIndices && !this._varIndices) {
      return { data, shape };
    }

    const [nRows, nCols] = shape;
    const obsIdx = this._obsIndices;
    const varIdx = this._varIndices;

    const outRows = obsIdx ? obsIdx.length : nRows;
    const outCols = varIdx ? varIdx.length : nCols;

    const Ctor = data.constructor as new (len: number) => TypedArray;
    const out = new Ctor(outRows * outCols);

    const rowIter = obsIdx ?? Array.from({ length: nRows }, (_, i) => i);

    for (let oi = 0; oi < rowIter.length; oi++) {
      const srcRow = rowIter[oi];
      if (varIdx) {
        for (let vi = 0; vi < varIdx.length; vi++) {
          out[oi * outCols + vi] = data[srcRow * nCols + varIdx[vi]] as number;
        }
      } else {
        // Copy entire row
        const srcOffset = srcRow * nCols;
        for (let c = 0; c < nCols; c++) {
          out[oi * outCols + c] = data[srcOffset + c] as number;
        }
      }
    }

    return { data: out, shape: [outRows, outCols] };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Get the value at index i from a ColumnData, handling categorical/nullable/typed arrays. */
function getColumnValue(col: ColumnData, i: number): Scalar | null {
  // CategoricalArray or NullableArray
  if ("at" in col && typeof (col as any).at === "function") {
    return (col as CategoricalArray | NullableArray).at(i);
  }
  // string[]
  if (Array.isArray(col)) return col[i];
  // TypedArray
  return (col as any)[i] as number;
}
