/**
 * Streaming primitives for axial.
 *
 * Uses Bun's Direct ReadableStream for zero-copy chunk streaming.
 * Async generators throughout — composable with for-await and Bun.serve.
 */

import type { Dtype, Scalar } from "./types.ts";

// ---------------------------------------------------------------------------
// Chunk types — what flows through the stream
// ---------------------------------------------------------------------------

/** A single decoded chunk from a Zarr array. */
export interface ArrayChunk {
  /** The raw data for this chunk. */
  data: ArrayBufferView;
  /** Shape of this chunk (may be smaller than full chunk at edges). */
  shape: number[];
  /** Dtype of the data. */
  dtype: Dtype;
  /** Chunk coordinates (indices into the chunk grid). */
  chunkCoords: number[];
  /** Offset of this chunk in the full array (in elements). */
  offset: number[];
}

/** A row-batch from an AnnData obs/var DataFrame. */
export interface DataFrameBatch {
  /** Column data for this batch. Keys = column names. */
  columns: Record<string, ArrayBufferView | (Scalar | null)[]>;
  /** Row offset in the full DataFrame. */
  rowOffset: number;
  /** Number of rows in this batch. */
  rowCount: number;
}

/** Arrow IPC bytes for a RecordBatch. */
export interface ArrowBatch {
  /** Serialized Arrow IPC RecordBatch. */
  ipc: Uint8Array;
  /** Number of rows in this batch. */
  rowCount: number;
  /** Batch index (0-based). */
  batchIndex: number;
}

// ---------------------------------------------------------------------------
// Stream factories
// ---------------------------------------------------------------------------

/**
 * Create a ReadableStream from an async generator.
 * Standard mode — works with any chunk type.
 */
export function streamFromGenerator<T>(
  gen: () => AsyncGenerator<T, void, unknown>,
): ReadableStream<T> {
  return new ReadableStream<T>({
    async start(controller) {
      for await (const chunk of gen()) {
        controller.enqueue(chunk);
      }
      controller.close();
    },
  });
}

/**
 * Create a Direct ReadableStream (Bun-specific, zero-copy) for binary data.
 * Only accepts string | ArrayBufferView | ArrayBuffer chunks.
 */
export function directStream(
  gen: () => AsyncGenerator<string | ArrayBufferView | ArrayBuffer, void, unknown>,
): ReadableStream<Uint8Array> {
  return new ReadableStream({
    type: "direct" as any,
    async pull(controller: any) {
      for await (const chunk of gen()) {
        controller.write(chunk);
      }
      controller.close();
    },
  });
}

/**
 * Create a TransformStream that maps each chunk through a function.
 */
export function mapTransform<In, Out>(
  fn: (chunk: In) => Out | Promise<Out>,
): TransformStream<In, Out> {
  return new TransformStream<In, Out>({
    async transform(chunk, controller) {
      controller.enqueue(await fn(chunk));
    },
  });
}

/**
 * Create a TransformStream that filters chunks.
 */
export function filterTransform<T>(
  pred: (chunk: T) => boolean | Promise<boolean>,
): TransformStream<T, T> {
  return new TransformStream<T, T>({
    async transform(chunk, controller) {
      if (await pred(chunk)) {
        controller.enqueue(chunk);
      }
    },
  });
}

/**
 * Create a TransformStream that batches N items together.
 */
export function batchTransform<T>(size: number): TransformStream<T, T[]> {
  let buffer: T[] = [];
  return new TransformStream<T, T[]>({
    transform(chunk, controller) {
      buffer.push(chunk);
      if (buffer.length >= size) {
        controller.enqueue(buffer);
        buffer = [];
      }
    },
    flush(controller) {
      if (buffer.length > 0) {
        controller.enqueue(buffer);
      }
    },
  });
}

// ---------------------------------------------------------------------------
// Stream consumption helpers
// ---------------------------------------------------------------------------

/** Collect all chunks from a ReadableStream into an array. */
export async function collect<T>(stream: ReadableStream<T>): Promise<T[]> {
  const result: T[] = [];
  for await (const chunk of stream) {
    result.push(chunk);
  }
  return result;
}

/** Count chunks in a stream without collecting them. */
export async function count(stream: ReadableStream<unknown>): Promise<number> {
  let n = 0;
  for await (const _ of stream) {
    n++;
  }
  return n;
}

/** Take first N chunks from a stream. */
export function take<T>(stream: ReadableStream<T>, n: number): ReadableStream<T> {
  let taken = 0;
  return stream.pipeThrough(
    new TransformStream<T, T>({
      transform(chunk, controller) {
        if (taken < n) {
          controller.enqueue(chunk);
          taken++;
        }
        if (taken >= n) {
          controller.terminate();
        }
      },
    }),
  );
}

// ---------------------------------------------------------------------------
// DataFrame streaming
// ---------------------------------------------------------------------------

/**
 * Stream obs/var DataFrame rows in batches.
 * Yields DataFrameBatch objects that can be piped to Arrow conversion.
 */
export async function* streamDataFrameBatches(
  columns: ReadonlyMap<string, any>,
  columnOrder: readonly string[],
  totalRows: number,
  batchSize = 4096,
): AsyncGenerator<DataFrameBatch, void, unknown> {
  for (let offset = 0; offset < totalRows; offset += batchSize) {
    const end = Math.min(offset + batchSize, totalRows);
    const rowCount = end - offset;
    const batch: Record<string, ArrayBufferView | (Scalar | null)[]> = {};

    for (const name of columnOrder) {
      const col = columns.get(name);
      if (!col) continue;

      if (ArrayBuffer.isView(col)) {
        // TypedArray — subarray is zero-copy
        batch[name] = (col as any).subarray(offset, end);
      } else if (Array.isArray(col)) {
        batch[name] = col.slice(offset, end);
      } else if ("at" in col && "length" in col) {
        // Categorical or Nullable — decode the batch
        const values: (Scalar | null)[] = [];
        for (let i = offset; i < end; i++) {
          values.push(col.at(i));
        }
        batch[name] = values;
      }
    }

    yield { columns: batch, rowOffset: offset, rowCount };
  }
}
