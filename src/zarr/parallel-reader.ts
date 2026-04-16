/**
 * Parallel obs/var reader using Bun Worker threads.
 * Dispatches each column to a worker for independent zarrita read + decode.
 * Reassembles results on the main thread into an AnnDataFrame.
 */

import type { AnnDataFrame, ColumnData, Scalar } from "./types.ts";
import { SimpleCategorical, SimpleNullable } from "./categorical.ts";

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

  // Create worker pool from the column-worker script.
  // `bun build --compile` emits bundled worker entrypoints at
  // `/$bunfs/root/<name>.js`. Non-entry files like this one keep their
  // original dev-filesystem `import.meta.url`, so we can't use a relative
  // URL in compiled mode — hard-code the bunfs path instead.
  const isCompiled = typeof Bun !== "undefined" && Array.isArray(Bun.embeddedFiles) && Bun.embeddedFiles.length > 0;
  const workerUrl = isCompiled
    ? "/$bunfs/root/zarr/column-worker.js"
    : new URL("./column-worker.ts", import.meta.url).href;
  const workers: Worker[] = [];
  const busy = new Set<number>();
  const dead = new Set<number>();
  const pending = new Map<number, PendingColumn>();
  const queue: PendingColumn[] = [];
  let nextId = 0;

  for (let i = 0; i < nWorkers; i++) {
    const workerIdx = i; // capture index in closure — not workers.indexOf()
    const worker = new Worker(workerUrl, { smol: true } as WorkerOptions);
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
      return new Ctor(r.data!, 0, r.length) as ColumnData;
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
