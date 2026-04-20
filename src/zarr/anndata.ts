/**
 * AnnData — convention parser, accessor, and public class.
 *
 * Three historically-separate concerns now in one file:
 *   1. Convention detector + parser (`detectAnnData`, `parseAnnData`) —
 *      consumed by `open.ts`.
 *   2. `AnnDataAccessor` — internal class doing lazy X / obsm / layer
 *      reads and `sel`/`isel` selection.
 *   3. `AnnData` — public class, thin wrapper over the accessor. Exposes
 *      obs/var as `LazyDataFrame`s and adds `toDuckDB()` ingest.
 */

import * as zarr from "zarrita";
import type { DuckDBConnection } from "@duckdb/node-api";
import type { Readable } from "zarrita";
import type {
  AnnDataFrame,
  CategoricalArray,
  ColumnData,
  NullableArray,
  ParsedAnnData,
  ParsedMuData,
  Scalar,
  SparseArray,
} from "./types.ts";
import { CsrCscArray } from "./helpers.ts";
import { readDataFrame, readDataFrameParallel, readSparse } from "./readers.ts";
import { extractStore } from "./zarr-boundary.ts";
import { LazyDataFrame } from "./data-frame.ts";
import { open as openStore } from "./open.ts";
import { ingestDataFrame } from "./duckdb-ingest.ts";

type ZarrGroup = zarr.Group<Readable>;

// ─── Convention detector + parser ───────────────────────────────────────────

export function detectAnnData(rootAttrs: Record<string, unknown>): boolean {
  return rootAttrs["encoding-type"] === "anndata";
}

export async function parseAnnData(group: ZarrGroup, storePath?: string): Promise<ParsedAnnData> {
  const attrs = (group.attrs ?? {}) as Record<string, unknown>;
  const obs = await readAxisFrame(group, "obs", storePath, /*required*/ true);
  const varDf = await readAxisFrame(group, "var", storePath, /*required*/ false);
  return {
    kind: "anndata",
    obs,
    var: varDf,
    attrs,
    group,
    storePath,
  };
}

/**
 * Read an axis DataFrame (obs or var). Parallel reader if we have a local
 * filesystem path (42x faster on large stores), else fall back to sequential.
 * `required=false` swallows missing-group errors — var can legitimately be
 * empty on embedding-only stores.
 */
async function readAxisFrame(
  group: ZarrGroup,
  axis: "obs" | "var",
  storePath: string | undefined,
  required: boolean,
): Promise<AnnDataFrame | undefined> {
  try {
    const axisGroup = await zarr.open(group.resolve(axis), { kind: "group" });
    if (storePath) {
      const axisAttrs = (axisGroup.attrs ?? {}) as Record<string, unknown>;
      const columnOrder = (axisAttrs["column-order"] as string[]) ?? [];
      const indexName = (axisAttrs._index as string) ?? "_index";
      return await readDataFrameParallel(storePath, axis, columnOrder, indexName);
    }
    return await readDataFrame(axisGroup as unknown as Parameters<typeof readDataFrame>[0]);
  } catch (e) {
    if (required) {
      throw new Error(`Failed to read ${axis} DataFrame: ${e instanceof Error ? e.message : String(e)}`, {
        cause: e,
      });
    }
    console.warn(`Warning: failed to read ${axis} DataFrame: ${e instanceof Error ? e.message : String(e)}`);
    return undefined;
  }
}

// ─── Accessor (internal) ────────────────────────────────────────────────────

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

/** Internal view over the relevant slice of `ParsedAnnData` / `ParsedMuData`. */
interface AxisSource {
  obs?: AnnDataFrame;
  var?: AnnDataFrame;
  group?: ZarrGroup;
  storePath?: string;
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
  private readonly _source: AxisSource;
  private readonly _group: ZarrGroup | undefined;
  private readonly _storePath: string | undefined;
  private readonly _obsIndices: number[] | null;
  private readonly _varIndices: number[] | null;

  constructor(
    source: AxisSource,
    group?: ZarrGroup,
    storePath?: string,
    obsIndices?: number[] | null,
    varIndices?: number[] | null,
  ) {
    this._source = source;
    this._group = group ?? source.group;
    this._storePath = storePath ?? source.storePath;
    this._obsIndices = obsIndices ?? null;
    this._varIndices = varIndices ?? null;
  }

  /** Create an AnnDataAccessor from a `ParsedAnnData` or `ParsedMuData`. */
  static from(parsed: ParsedAnnData | ParsedMuData): AnnDataAccessor {
    return new AnnDataAccessor({
      obs: parsed.obs,
      var: parsed.var,
      group: parsed.group as ZarrGroup | undefined,
      storePath: parsed.storePath,
    });
  }

  /** The obs DataFrame (already loaded). */
  get obs(): AnnDataFrame {
    const o = this._source.obs;
    if (!o) throw new Error("No obs DataFrame available");
    return o;
  }

  /** The var DataFrame (already loaded). */
  get var(): AnnDataFrame {
    const v = this._source.var;
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
    const idx = this._source.obs?.index;
    return idx ? idx.length : 0;
  }

  /** Number of selected variables. */
  get nVar(): number {
    if (this._varIndices) return this._varIndices.length;
    const idx = this._source.var?.index;
    return idx ? idx.length : 0;
  }

  // ---------------------------------------------------------------------------
  // Lazy data loading
  // ---------------------------------------------------------------------------

  /**
   * Load the X matrix (expression data).
   * Applies any active obs/var selection.
   */
  getX(): Promise<MatrixResult> {
    return this._loadMatrix("X");
  }

  /**
   * Load a layer by name (e.g. "raw_counts", "normalized").
   * Applies any active obs/var selection.
   */
  getLayer(name: string): Promise<MatrixResult> {
    return this._loadMatrix(`layers/${name}`);
  }

  /**
   * List the embedding keys present under `obsm/`.
   *
   * Strategy (most-portable first):
   *   1. Wrap the backing store with `withConsolidatedMetadata` — reads
   *      `.zmetadata` (v2) or `consolidated_metadata` in `zarr.json` (v3).
   *      AnnData-Python writes consolidated metadata by default, so this
   *      covers most on-disk and HTTP-hosted AnnData stores in one request.
   *   2. Fall back to filesystem `readdir` when we have a local store path.
   *   3. Return `null` so callers can probe a known-names list (no
   *      generic store listing exists in the Zarr spec).
   *
   * Entries that don't look like zarr arrays/groups are filtered out.
   */
  async listObsmKeys(): Promise<string[] | null> {
    const group = this._group;
    if (group) {
      const consolidated = await this._listObsmKeysConsolidated(group);
      if (consolidated) return consolidated;
    }
    if (this._storePath) {
      return this._listObsmKeysReaddir(this._storePath);
    }
    return null;
  }

  private async _listObsmKeysConsolidated(group: ZarrGroup): Promise<string[] | null> {
    try {
      const store = extractStore(group);
      if (!store) return null;
      const listable = await zarr.withConsolidatedMetadata(store);
      const groupPath = group.path.endsWith("/") ? group.path : `${group.path}/`;
      const obsmPrefix = `${groupPath}obsm/`;
      const keys = new Set<string>();
      for (const entry of listable.contents()) {
        if (!entry.path.startsWith(obsmPrefix)) continue;
        const rest = entry.path.slice(obsmPrefix.length);
        if (!rest) continue;
        // Take the first path segment — arrays show as "obsm/X_umap", groups
        // show as "obsm/X_umap" (then children at deeper paths).
        const first = rest.split("/")[0];
        if (first) keys.add(first);
      }
      return [...keys].toSorted();
    } catch {
      // No consolidated metadata available — let caller try the next strategy.
      return null;
    }
  }

  private async _listObsmKeysReaddir(storePath: string): Promise<string[]> {
    const { readdir, stat } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const obsmDir = join(storePath, "obsm");
    let entries: string[];
    try {
      entries = await readdir(obsmDir);
    } catch {
      return [];
    }
    const keys: string[] = [];
    for (const entry of entries) {
      if (entry.startsWith(".") || entry === "__pycache__") continue;
      try {
        const full = join(obsmDir, entry);
        const s = await stat(full);
        if (!s.isDirectory()) continue;
        const contents = await readdir(full);
        const isZarr = contents.some((f) => f === ".zarray" || f === ".zgroup" || f === "zarr.json");
        if (isZarr) keys.push(entry);
      } catch {
        /* skip unreadable entries */
      }
    }
    return keys.toSorted();
  }

  /**
   * Load an obsm embedding by name (e.g. "X_pca", "X_umap").
   * Returns a dense array. Applies obs selection.
   */
  async getObsm(name: string): Promise<DenseResult> {
    const path = `obsm/${name}`;
    if (!this._group) throw new Error("No zarr group available — cannot lazy load obsm");
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
        throw new Error(`obs column "${colName}" not found. Available: ${obs.columnOrder.join(", ")}`);
      }

      const matchValues = Array.isArray(queryValue) ? queryValue : [queryValue];
      candidates = candidates.filter((i) => {
        const cellValue = getColumnValue(col, i);
        return matchValues.some((qv) => cellValue === qv);
      });
    }

    return new AnnDataAccessor(this._source, this._group, this._storePath, candidates, this._varIndices);
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

    return new AnnDataAccessor(this._source, this._group, this._storePath, newObs, newVar);
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  /**
   * Load a matrix from a relative path (X, layers/name).
   * Handles both sparse (CSR/CSC) and dense arrays.
   */
  private async _loadMatrix(path: string): Promise<MatrixResult> {
    if (!this._group) throw new Error("No zarr group available — cannot lazy load matrix");
    const location = this._group.resolve(path);

    // Try as sparse group first
    try {
      const grp = await zarr.open(location, { kind: "group" });
      const attrs = (grp.attrs ?? {}) as Record<string, unknown>;
      const encoding = attrs["encoding-type"] as string | undefined;

      if (encoding === "csr_matrix" || encoding === "csc_matrix") {
        const sparse = await readSparse(grp as unknown as Parameters<typeof readSparse>[0]);
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
          out[oi * outCols + vi] = data[srcRow * nCols + varIdx[vi]];
        }
      } else {
        // Copy entire row
        const srcOffset = srcRow * nCols;
        for (let c = 0; c < nCols; c++) {
          out[oi * outCols + c] = data[srcOffset + c];
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
  const withAt = col as { at?: (i: number) => Scalar | null };
  if (typeof withAt.at === "function") {
    return (col as CategoricalArray | NullableArray).at(i);
  }
  // string[]
  if (Array.isArray(col)) return col[i];
  // TypedArray
  return (col as ArrayLike<number>)[i];
}

// ─── Public class + toDuckDB ingest ─────────────────────────────────────────

export interface ToDuckDBOptions {
  /** Table name for the obs axis. Default: "obs_base". */
  obsTable?: string;
  /** Table name for the var axis. Default: "var_base". */
  varTable?: string;
  /** Skip one axis (defaults false). */
  skipObs?: boolean;
  skipVar?: boolean;
}

export class AnnData {
  readonly obs: LazyDataFrame;
  readonly var: LazyDataFrame;
  private readonly _accessor: AnnDataAccessor;

  constructor(accessor: AnnDataAccessor) {
    this._accessor = accessor;
    this.obs = new LazyDataFrame(accessor.obs, "obs_name");
    this.var = new LazyDataFrame(accessor.var, "var_name");
  }

  /** Build from a parsed AnnData / MuData result. */
  static from(parsed: ParsedAnnData | ParsedMuData): AnnData {
    return new AnnData(AnnDataAccessor.from(parsed));
  }

  /** One-call opener: resolve store + detect convention + wrap. */
  static async open(location: string | Readable): Promise<AnnData> {
    const parsed = await openStore(location);
    if (parsed.kind === "ome-zarr") {
      throw new Error("AnnData.open: store is OME-Zarr, not AnnData/MuData");
    }
    return AnnData.from(parsed);
  }

  get shape(): readonly [number, number] {
    return [this._accessor.nObs, this._accessor.nVar];
  }

  get nObs(): number {
    return this._accessor.nObs;
  }

  get nVars(): number {
    return this._accessor.nVar;
  }

  // ── Lazy matrix / embedding reads — delegate to accessor ────────────────

  getX(): Promise<MatrixResult> {
    return this._accessor.getX();
  }

  getLayer(name: string): Promise<MatrixResult> {
    return this._accessor.getLayer(name);
  }

  getObsm(name: string): Promise<DenseResult> {
    return this._accessor.getObsm(name);
  }

  listObsmKeys(): Promise<string[] | null> {
    return this._accessor.listObsmKeys();
  }

  // ── Selection (still delegate to accessor; Phase C replaces with real view) ─

  isel(indices: { obs?: number[]; var?: number[] }): AnnData {
    return new AnnData(this._accessor.isel(indices));
  }

  sel(query: Record<string, unknown>): AnnData {
    return new AnnData(this._accessor.sel(query));
  }

  /**
   * Register obs and var DataFrames as queryable tables on `conn`.
   *
   * Both tables carry a `__{axis}_index__ INTEGER` identity column and a
   * `{axis}_name VARCHAR` from the DataFrame's index. Cross-axis join is
   * left to the caller — the tables are independent by construction
   * (obs_base has nObs rows; var_base has nVars rows).
   */
  async toDuckDB(conn: DuckDBConnection, options: ToDuckDBOptions = {}): Promise<void> {
    const obsTable = options.obsTable ?? "obs_base";
    const varTable = options.varTable ?? "var_base";
    if (!options.skipObs) {
      await ingestDataFrame(conn, obsTable, this.obs, {
        axis: "obs",
        includeNameColumn: true,
      });
    }
    if (!options.skipVar) {
      await ingestDataFrame(conn, varTable, this.var, {
        axis: "var",
        includeNameColumn: true,
      });
    }
  }

  /** Escape hatch — underlying accessor. Prefer AnnData's own methods. */
  get accessor(): AnnDataAccessor {
    return this._accessor;
  }
}
