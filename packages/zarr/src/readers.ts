/**
 * AnnData column readers: sequential + parallel.
 *
 * Two entry points:
 *  - `readDataFrame(group)`: sequential, reads every column on the main
 *    thread. Used when Bun Workers aren't available (non-filesystem
 *    stores, tests, small stores where worker startup dominates).
 *  - `readDataFrameParallel(path, group, …)`: farms each column to a
 *    Bun Worker (see `column-worker.ts`). 42× speedup on large stores
 *    over local filesystem.
 *
 * Sequential dispatch lives in this file. The worker has its own inline
 * decoders producing a serializable `ColumnResult` shape; `reassembleColumn`
 * below converts those back into `ColumnData`. Sharing the decoder bodies
 * between main + worker would require producing `ColumnResult` on the main
 * thread and re-wrapping: net LoC neutral, deferred as follow-up.
 *
 * Encoding types handled by the sequential path:
 *   array, categorical, nullable-string-array, nullable-integer,
 *   nullable-boolean, csr_matrix, csc_matrix, dataframe, string-array,
 *   numeric-scalar, string, null
 */

import * as zarr from "zarrita";
import type { Readable } from "zarrita";
import type {
  AnnDataFrame,
  CategoricalArray,
  ColumnData,
  EncodingType,
  NullableArray,
  Scalar,
  SparseArray,
} from "./types.ts";
import { columnWorkerUrl } from "./column-worker-path.ts";
import { CsrCscArray, SimpleCategorical, SimpleNullable } from "./helpers.ts";

// zarrita group/array types are complex: use structural typing
type ZarrGroup = Awaited<ReturnType<typeof zarr.open<Readable>>> & {
  resolve: (path: string) => zarr.Location<Readable>;
  attrs: Record<string, unknown>;
};

type ZarrChunkData = zarr.Chunk<zarr.DataType>["data"];

/** Read encoding-type from a group or array's attrs. */
export function getEncodingType(attrs: Record<string, unknown>): EncodingType | undefined {
  return attrs["encoding-type"] as EncodingType | undefined;
}

/** Read a zarr array and return its full data as a typed array. */
async function readArray(
  location: zarr.Location<Readable>,
): Promise<{ data: ZarrChunkData; shape: number[]; dtype: string }> {
  const arr = await zarr.open(location, { kind: "array" });
  const result = await zarr.get(arr);
  return { data: result.data, shape: [...arr.shape], dtype: arr.dtype };
}

/**
 * Read a categorical column.
 * Structure: group with codes/ array and categories/ (which may be a plain array
 * or a nullable-string-array group with values/ + mask/).
 */
export async function readCategorical(group: ZarrGroup): Promise<CategoricalArray> {
  const ordered = (group.attrs.ordered as boolean) ?? false;

  // Read codes
  const { data: codes } = await readArray(group.resolve("codes"));

  // Categories might be a plain array or a nullable-string-array group
  let categories: Scalar[];
  try {
    // Try as plain array first
    const { data: catData } = await readArray(group.resolve("categories"));
    categories = (Array.isArray(catData) ? catData : Array.from(catData as Iterable<unknown>)) as Scalar[];
  } catch {
    // It's a group (nullable-string-array): read values/ sub-array
    const catGroup = await zarr.open(group.resolve("categories"), { kind: "group" });
    const { data: values } = await readArray(catGroup.resolve("values"));
    categories = (Array.isArray(values) ? values : Array.from(values as Iterable<unknown>)) as Scalar[];
    // mask indicates null categories: rare but handle it
  }

  return new SimpleCategorical(categories, codes as Int8Array | Int16Array | Int32Array, ordered);
}

/**
 * Read a nullable array (values/ + mask/ pattern).
 * Used for nullable-integer, nullable-boolean, nullable-string, nullable-string-array.
 */
export async function readNullable(group: ZarrGroup): Promise<NullableArray> {
  const { data: values } = await readArray(group.resolve("values"));
  const { data: mask } = await readArray(group.resolve("mask"));

  // Convert BoolArray to Uint8Array if needed (zarrita returns BoolArray for bool dtype)
  const maskU8 =
    mask instanceof Uint8Array ? mask : Uint8Array.from(mask as Iterable<number | boolean>, (v) => (v ? 1 : 0));

  return new SimpleNullable(values as ArrayLike<Scalar>, maskU8);
}

/**
 * Read a sparse matrix (CSR or CSC).
 * Structure: group with data/, indices/, indptr/ arrays and shape in attrs.
 */
export async function readSparse(group: ZarrGroup): Promise<SparseArray> {
  const encoding = getEncodingType(group.attrs);
  const format = encoding === "csc_matrix" ? "csc" : "csr";
  const shape = group.attrs.shape as [number, number];

  const [{ data }, { data: indices }, { data: indptr }] = await Promise.all([
    readArray(group.resolve("data")),
    readArray(group.resolve("indices")),
    readArray(group.resolve("indptr")),
  ]);

  return new CsrCscArray({
    shape,
    format,
    data: data as Float32Array | Float64Array,
    indices: indices as Int32Array,
    indptr: indptr as Int32Array,
  });
}

/**
 * Read an AnnData DataFrame (obs or var).
 * Structure: group with _index attr, column-order attr, and each column as a sub-element.
 */
export async function readDataFrame(group: ZarrGroup): Promise<AnnDataFrame> {
  const indexName = group.attrs._index as string | undefined;
  if (!indexName) {
    throw new Error('DataFrame group is missing "_index" attr: cannot determine index column name');
  }
  const columnOrder = (group.attrs["column-order"] as string[]) ?? [];

  // Read index column
  const indexCol = await readElement(group, indexName);
  const index = extractValues(indexCol);

  // Read each column in order
  const columns = new Map<string, ColumnData>();
  const readPromises = columnOrder.map(async (colName) => {
    const colData = await readElement(group, colName);
    columns.set(colName, colData);
  });
  await Promise.all(readPromises);

  return {
    index: index as string[] | Int32Array,
    columns,
    columnOrder,
    column(name: string) {
      return columns.get(name);
    },
    *[Symbol.iterator]() {
      const len = index.length;
      for (let i = 0; i < len; i++) {
        const row: Record<string, Scalar | null> = {};
        for (const [name, col] of columns) {
          row[name] = getValueAt(col, i);
        }
        yield row;
      }
    },
  };
}

/**
 * Read a single element by dispatching on its encoding-type.
 * This is the main dispatch function.
 */
export async function readElement(parentGroup: ZarrGroup, name: string): Promise<ColumnData> {
  const location = parentGroup.resolve(name);

  // Try opening as a group first (categorical, nullable, sparse, dataframe are groups)
  try {
    const group = await zarr.open(location, { kind: "group" });
    const attrs = (group.attrs ?? {}) as Record<string, unknown>;
    const encoding = getEncodingType(attrs);

    switch (encoding) {
      case "categorical":
        return await readCategorical(group as unknown as ZarrGroup);
      case "nullable-integer":
      case "nullable-boolean":
      case "nullable-string":
      case "nullable-string-array":
        return await readNullable(group as unknown as ZarrGroup);
      case "csr_matrix":
      case "csc_matrix":
        return (await readSparse(group)) as unknown as ColumnData;
      default:
        // Unknown group encoding: try reading as plain array
        break;
    }
  } catch (err) {
    // Only fall through to array read if the error indicates "not found" / "not a group".
    // Network errors, corruption, etc. should propagate.
    const msg = err instanceof Error ? err.message : String(err);
    if (!/not\s*found/i.test(msg) && !/NotFound/i.test(msg)) {
      throw new Error(`Failed to read element "${name}": ${msg}`, { cause: err });
    }
  }

  // Read as plain array
  const { data } = await readArray(location);
  return data as unknown as ColumnData;
}

// Helpers

function extractValues(col: ColumnData): string[] | Int32Array | (Scalar | null)[] {
  if (col instanceof Int32Array) return col;
  if (Array.isArray(col)) return col;
  if ("values" in col && "mask" in col) {
    // NullableArray: extract values, replacing masked with empty string
    const na = col;
    const result: string[] = [];
    for (let i = 0; i < na.length; i++) {
      const v = na.at(i);
      result.push(v !== null ? String(v) : "");
    }
    return result;
  }
  if ("codes" in col && "categories" in col) {
    return col.toArray();
  }
  // TypedArray: convert to regular array
  return Array.from(col as Iterable<Scalar>);
}

function getValueAt(col: ColumnData, i: number): Scalar | null {
  if ("at" in col && typeof col.at === "function") {
    return (col as CategoricalArray | NullableArray).at(i);
  }
  if (Array.isArray(col)) return col[i];
  return (col as ArrayLike<Scalar>)[i];
}

// ─── Windowed (streaming) reader ────────────────────────────────────────────
//
// `readDataFrame*` above materialize EVERY column in full before anything
// downstream runs: at 10M obs that one copy alone is multi-GB. `readDataFrameBatches`
// instead yields row-windows: it resolves each column's structure once (opening
// arrays, reading the small shared categorical dictionaries), then slices the
// per-row arrays per batch via `zarr.get(arr, [zarr.slice(r0, r1)])`. Peak JS is
// O(batch), not O(dataset). Consumed by `ingestDataFrameChunked` (duckdb-ingest.ts).

export interface DataFrameBatch {
  /** Windowed index values for rows [r0, r1). */
  index: ColumnData;
  /** Windowed column → data for rows [r0, r1). */
  columns: Map<string, ColumnData>;
  /** Row count in this batch (r1 - r0). */
  n: number;
}

interface WindowReader {
  read(r0: number, r1: number): Promise<ColumnData>;
}

/** Read a categorical's `categories` dictionary once (plain array or values group). */
async function readCategories(group: ZarrGroup): Promise<Scalar[]> {
  try {
    const { data } = await readArray(group.resolve("categories"));
    return (Array.isArray(data) ? data : Array.from(data as Iterable<unknown>)) as Scalar[];
  } catch {
    const catGroup = await zarr.open(group.resolve("categories"), { kind: "group" });
    const { data } = await readArray((catGroup as unknown as ZarrGroup).resolve("values"));
    return (Array.isArray(data) ? data : Array.from(data as Iterable<unknown>)) as Scalar[];
  }
}

/** Resolve a column's structure ONCE → a closure that slices rows [r0, r1) per batch. */
async function resolveWindowReader(group: ZarrGroup, name: string): Promise<WindowReader> {
  const location = group.resolve(name);
  try {
    const g = (await zarr.open(location, { kind: "group" })) as unknown as ZarrGroup;
    const encoding = getEncodingType(g.attrs);
    if (encoding === "categorical") {
      const codesArr = await zarr.open(g.resolve("codes"), { kind: "array" });
      const categories = await readCategories(g);
      const ordered = (g.attrs.ordered as boolean) ?? false;
      return {
        async read(r0, r1) {
          const codes = (await zarr.get(codesArr, [zarr.slice(r0, r1)])).data;
          return new SimpleCategorical(
            categories,
            codes as Int8Array | Int16Array | Int32Array,
            ordered,
          );
        },
      };
    }
    if (
      encoding === "nullable-integer" ||
      encoding === "nullable-boolean" ||
      encoding === "nullable-string" ||
      encoding === "nullable-string-array"
    ) {
      const valsArr = await zarr.open(g.resolve("values"), { kind: "array" });
      const maskArr = await zarr.open(g.resolve("mask"), { kind: "array" });
      return {
        async read(r0, r1) {
          const values = (await zarr.get(valsArr, [zarr.slice(r0, r1)])).data;
          const maskRaw = (await zarr.get(maskArr, [zarr.slice(r0, r1)])).data;
          const mask =
            maskRaw instanceof Uint8Array
              ? maskRaw
              : Uint8Array.from(maskRaw as Iterable<number | boolean>, (v) => (v ? 1 : 0));
          return new SimpleNullable(values as ArrayLike<Scalar>, mask);
        },
      };
    }
    // Unknown group encoding: fall through to a plain-array read.
  } catch {
    // Not a group: read as a plain array below.
  }
  const arr = await zarr.open(location, { kind: "array" });
  return {
    async read(r0, r1) {
      const data = (await zarr.get(arr, [zarr.slice(r0, r1)])).data;
      // Normalize exotic array-likes (zarrita BoolArray isn't index-accessible) →
      // plain array, matching the eager path's convertColumn. Standard TypedArrays
      // and string[] pass through untouched.
      if (!Array.isArray(data) && !ArrayBuffer.isView(data)) {
        return Array.from(data as Iterable<unknown>) as unknown as ColumnData;
      }
      return data as unknown as ColumnData;
    },
  };
}

/**
 * Stream an AnnData DataFrame (obs/var) in row-windows. AnnData layout only
 * (single group; MuData merge is a separate path). Default batch is chunk-sized.
 */
export async function* readDataFrameBatches(
  store: Parameters<typeof zarr.open>[0],
  groupPath: string,
  batchSize = 250_000,
): AsyncGenerator<DataFrameBatch> {
  const root = await zarr.open(store);
  const group = (await zarr.open((root as unknown as ZarrGroup).resolve(groupPath), {
    kind: "group",
  })) as unknown as ZarrGroup;
  const indexName = group.attrs._index as string | undefined;
  if (!indexName) throw new Error(`DataFrame "${groupPath}" missing "_index" attr`);
  const columnOrder = (group.attrs["column-order"] as string[]) ?? [];

  const indexReader = await resolveWindowReader(group, indexName);
  const colReaders: [string, WindowReader][] = [];
  for (const n of columnOrder) colReaders.push([n, await resolveWindowReader(group, n)]);

  const idxArr = await zarr.open(group.resolve(indexName), { kind: "array" });
  const nObs = idxArr.shape[0];

  for (let r0 = 0; r0 < nObs; r0 += batchSize) {
    const r1 = Math.min(r0 + batchSize, nObs);
    const index = await indexReader.read(r0, r1);
    const columns = new Map<string, ColumnData>();
    for (const [n, reader] of colReaders) columns.set(n, await reader.read(r0, r1));
    yield { index, columns, n: r1 - r0 };
  }
}

// ─── Parallel reader (Bun Workers) ─────────────────────────────────────────

type TypedArrayCtor =
  | Float32ArrayConstructor
  | Float64ArrayConstructor
  | Int8ArrayConstructor
  | Int16ArrayConstructor
  | Int32ArrayConstructor
  | BigInt64ArrayConstructor
  | Uint8ArrayConstructor
  | Uint16ArrayConstructor
  | Uint32ArrayConstructor
  | BigUint64ArrayConstructor;

interface ColumnResult {
  encoding: "typed" | "categorical" | "nullable" | "string-array" | "bool-array";
  data?: ArrayBuffer;
  dtype?: string;
  length?: number;
  categories?: (string | number)[];
  codes?: ArrayBuffer;
  codesDtype?: string;
  ordered?: boolean;
  values?: unknown[];
  mask?: ArrayBuffer;
  array?: unknown[];
}

interface PendingColumn {
  id: number;
  name: string;
  resolve: (result: ColumnResult) => void;
  reject: (error: Error) => void;
}

/**
 * Read an AnnData DataFrame (obs or var) in parallel using worker threads.
 *
 * @param storePath - Filesystem path to the zarr store root
 * @param groupPath - Group path within the store (e.g. "obs" or "var")
 * @param columnOrder - Ordered list of column names to read
 * @param indexName - Name of the index column
 * @param workerCount - Number of parallel workers (default: CPU count, capped at 8)
 */
export async function readDataFrameParallel(
  storePath: string,
  groupPath: string,
  columnOrder: string[],
  indexName: string,
  workerCount?: number,
): Promise<AnnDataFrame> {
  const nWorkers = Math.min(workerCount ?? navigator.hardwareConcurrency ?? 4, 8);
  const allCols = [indexName, ...columnOrder];

  // Keep the build entrypoint and runtime URL on one path contract.
  const workerUrl = columnWorkerUrl();
  const workers: Worker[] = [];
  const busy = new Set<number>();
  const dead = new Set<number>();
  const pending = new Map<number, PendingColumn>();
  const queue: PendingColumn[] = [];
  let nextId = 0;

  for (let i = 0; i < nWorkers; i++) {
    const workerIdx = i; // capture index in closure: not workers.indexOf()
    const worker = new Worker(workerUrl, { smol: true });
    worker.addEventListener("message", (event: MessageEvent) => {
      const { id, result, error } = event.data;
      const task = pending.get(id);
      if (task) {
        pending.delete(id);
        busy.delete(workerIdx);
        if (error) {
          task.reject(new Error(error));
        } else {
          task.resolve(result);
        }
        dispatchNext();
      }
    });
    worker.addEventListener("error", (event) => {
      // Mark worker as dead so it is never re-dispatched
      busy.delete(workerIdx);
      dead.add(workerIdx);
      const errEvent = event;
      const err = new Error(`Worker ${workerIdx} failed: ${errEvent.message}`);
      for (const task of pending.values()) {
        task.reject(err);
      }
      pending.clear();
      for (const task of queue) {
        task.reject(err);
      }
      queue.length = 0;
    });
    workers.push(worker);
  }

  function findIdleWorker(): number {
    for (let i = 0; i < workers.length; i++) {
      if (!busy.has(i) && !dead.has(i)) return i;
    }
    return -1;
  }

  function dispatchNext() {
    while (queue.length > 0) {
      const idx = findIdleWorker();
      if (idx === -1) break;
      const task = queue.shift()!;
      busy.add(idx);
      pending.set(task.id, task);
      workers[idx].postMessage({
        id: task.id,
        storePath,
        groupPath,
        colName: task.name,
      });
    }
  }

  // Submit all column reads
  const resultPromises = allCols.map(
    (colName) =>
      new Promise<{ name: string; result: ColumnResult }>((resolve, reject) => {
        const task: PendingColumn = {
          id: nextId++,
          name: colName,
          resolve: (result) => resolve({ name: colName, result }),
          reject,
        };
        queue.push(task);
      }),
  );

  // Start dispatching
  dispatchNext();

  // Wait for all columns with a 60s timeout to prevent indefinite hangs
  const TIMEOUT_MS = 60_000;
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      // Identify which columns are still pending
      const stuckColumns = [...pending.values()].map((t) => t.name);
      reject(
        new Error(`Parallel read timed out after ${TIMEOUT_MS / 1000}s. Stuck columns: [${stuckColumns.join(", ")}]`),
      );
    }, TIMEOUT_MS);
  });
  const results = await Promise.race([Promise.all(resultPromises), timeoutPromise]);

  // Terminate workers
  for (const w of workers) w.terminate();

  // Reassemble into AnnDataFrame
  const columns = new Map<string, ColumnData>();
  let index: string[] | Int32Array = [];

  for (const { name, result } of results) {
    const col = reassembleColumn(result);
    if (name === indexName) {
      index = col as string[] | Int32Array;
    } else {
      columns.set(name, col);
    }
  }

  return {
    index,
    columns,
    columnOrder,
    column(name: string) {
      return columns.get(name);
    },
    *[Symbol.iterator]() {
      const len = Array.isArray(index) ? index.length : index.length;
      for (let i = 0; i < len; i++) {
        const row: Record<string, Scalar | null> = {};
        for (const [colName, col] of columns) {
          const withAt = col as { at?: (i: number) => Scalar | null };
          if (typeof withAt.at === "function") {
            row[colName] = withAt.at(i);
          } else if (Array.isArray(col)) {
            row[colName] = col[i];
          } else {
            row[colName] = (col as ArrayLike<Scalar>)[i];
          }
        }
        yield row;
      }
    },
  };
}

/** Convert a worker ColumnResult back into our ColumnData types. */
function reassembleColumn(r: ColumnResult): ColumnData {
  switch (r.encoding) {
    case "typed": {
      const Ctor = dtypeToTypedArray(r.dtype!);
      return new Ctor(r.data!, 0, r.length);
    }
    case "categorical": {
      const Ctor = dtypeToTypedArray(r.codesDtype!);
      const codes = new Ctor(r.codes!, 0, r.codes!.byteLength / Ctor.BYTES_PER_ELEMENT) as
        | Int8Array
        | Int16Array
        | Int32Array;
      return new SimpleCategorical(r.categories!, codes, r.ordered ?? false);
    }
    case "nullable": {
      const mask = new Uint8Array(r.mask!);
      return new SimpleNullable(r.values! as ArrayLike<Scalar>, mask);
    }
    case "string-array":
      return r.array as string[];
    case "bool-array":
      return r.array as unknown as ColumnData;
    default:
      throw new Error(`Unknown encoding: ${String(r.encoding)}`);
  }
}

function dtypeToTypedArray(dtype: string): TypedArrayCtor {
  switch (dtype) {
    case "float32":
      return Float32Array;
    case "float64":
      return Float64Array;
    case "int8":
      return Int8Array;
    case "int16":
      return Int16Array;
    case "int32":
      return Int32Array;
    case "int64":
      return BigInt64Array;
    case "uint8":
      return Uint8Array;
    case "uint16":
      return Uint16Array;
    case "uint32":
      return Uint32Array;
    case "uint64":
      return BigUint64Array;
    case "bool":
      return Uint8Array;
    default:
      throw new Error(`Unsupported dtype: "${dtype}"`);
  }
}
