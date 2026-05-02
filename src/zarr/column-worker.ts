/**
 * Worker script for parallel column reading.
 * Each worker independently opens zarrita, reads one obs/var column, posts back decoded data.
 *
 * Message protocol:
 *   Main → Worker: { id, storePath, groupPath, colName }
 *   Worker → Main: { id, result: { encoding, data, ... } } | { id, error }
 */
declare let self: Worker;

import * as zarr from "zarrita";
import type { Readable } from "zarrita";
import FileSystemStore from "@zarrita/storage/fs";

type ZarrLocation = zarr.Location<Readable>;
type ZarrGroup = zarr.Group<Readable>;

interface ReadColumnRequest {
  id: number;
  storePath: string;
  groupPath: string; // e.g. "obs"
  colName: string;
}

interface ColumnResult {
  encoding: "typed" | "categorical" | "nullable" | "string-array" | "bool-array";
  // For typed arrays
  data?: ArrayBuffer;
  dtype?: string;
  length?: number;
  // For categorical
  categories?: (string | number)[];
  codes?: ArrayBuffer;
  codesDtype?: string;
  ordered?: boolean;
  // For nullable
  values?: unknown[];
  mask?: ArrayBuffer;
  // For string/bool arrays
  array?: unknown[];
}

self.addEventListener("message", async (event: MessageEvent<ReadColumnRequest>) => {
  const { id, storePath, groupPath, colName } = event.data;
  try {
    const store = new FileSystemStore(storePath);
    const root = await zarr.open(store, { kind: "group" });
    const group = await zarr.open(root.resolve(groupPath), { kind: "group" });
    const location = group.resolve(colName);

    let result: ColumnResult;

    // Try as group first (categorical, nullable)
    try {
      const colGroup = await zarr.open(location, { kind: "group" });
      const attrs = (colGroup.attrs ?? {}) as Record<string, unknown>;
      const encoding = attrs["encoding-type"] as string;

      if (encoding === "categorical") {
        result = await readCategoricalWorker(colGroup);
      } else if (
        encoding === "nullable-integer" ||
        encoding === "nullable-boolean" ||
        encoding === "nullable-string" ||
        encoding === "nullable-string-array"
      ) {
        result = await readNullableWorker(colGroup);
      } else {
        // Unknown group — try as array
        result = await readArrayWorker(location);
      }
    } catch {
      // Not a group — read as array
      result = await readArrayWorker(location);
    }

    self.postMessage({ id, result });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    self.postMessage({ id, error: message });
  }
});

async function readArrayWorker(location: ZarrLocation): Promise<ColumnResult> {
  const arr = await zarr.open(location, { kind: "array" });
  const chunk = await zarr.get(arr);
  const data = chunk.data;

  // Handle BoolArray (zarrita custom type)
  if (data.constructor.name === "BoolArray") {
    const boolArr = Array.from(data as Iterable<unknown>);
    return { encoding: "bool-array", array: boolArr };
  }

  // Handle string arrays
  if (Array.isArray(data)) {
    return { encoding: "string-array", array: data };
  }

  // TypedArray — transfer the buffer
  const view = data as ArrayBufferView;
  const buf = view.buffer as ArrayBuffer;
  const buffer = buf.slice(view.byteOffset, view.byteOffset + view.byteLength);
  const bytesPerElement = (data as { BYTES_PER_ELEMENT?: number }).BYTES_PER_ELEMENT ?? 1;
  return {
    encoding: "typed",
    data: buffer,
    dtype: arr.dtype,
    length: view.byteLength / bytesPerElement,
  };
}

async function readCategoricalWorker(group: ZarrGroup): Promise<ColumnResult> {
  const ordered = (group.attrs?.ordered as boolean) ?? false;

  // Read codes
  const codesArr = await zarr.open(group.resolve("codes"), { kind: "array" });
  const codesChunk = await zarr.get(codesArr);
  const codesData = codesChunk.data;
  const codesView = codesData as ArrayBufferView;
  const codesBuf = codesView.buffer as ArrayBuffer;
  const codesBuffer = codesBuf.slice(codesView.byteOffset, codesView.byteOffset + codesView.byteLength);

  // Read categories (may be plain array or nullable-string-array group)
  let categories: (string | number)[];
  try {
    const catArr = await zarr.open(group.resolve("categories"), { kind: "array" });
    const catChunk = await zarr.get(catArr);
    categories = Array.isArray(catChunk.data)
      ? (catChunk.data as (string | number)[])
      : Array.from(catChunk.data as Iterable<string | number>);
  } catch {
    // It's a group (nullable-string-array)
    const catGroup = await zarr.open(group.resolve("categories"), { kind: "group" });
    const valsArr = await zarr.open(catGroup.resolve("values"), { kind: "array" });
    const valsChunk = await zarr.get(valsArr);
    categories = Array.isArray(valsChunk.data)
      ? (valsChunk.data as (string | number)[])
      : Array.from(valsChunk.data as Iterable<string | number>);
  }

  return {
    encoding: "categorical",
    categories,
    codes: codesBuffer,
    codesDtype: codesArr.dtype,
    ordered,
  };
}

async function readNullableWorker(group: ZarrGroup): Promise<ColumnResult> {
  const valsArr = await zarr.open(group.resolve("values"), { kind: "array" });
  const valsChunk = await zarr.get(valsArr);
  const maskArr = await zarr.open(group.resolve("mask"), { kind: "array" });
  const maskChunk = await zarr.get(maskArr);

  // Values: could be strings or typed array
  let values: unknown[];
  if (Array.isArray(valsChunk.data)) {
    values = valsChunk.data;
  } else {
    values = Array.from(valsChunk.data as Iterable<unknown>);
  }

  // Mask: BoolArray or Uint8Array
  const maskData = maskChunk.data;
  let maskBuffer: ArrayBuffer;
  if (maskData instanceof Uint8Array) {
    maskBuffer = (maskData.buffer as ArrayBuffer).slice(maskData.byteOffset, maskData.byteOffset + maskData.byteLength);
  } else {
    // BoolArray → convert to Uint8Array
    const u8 = Uint8Array.from(maskData as Iterable<number | boolean>, (v) => (v ? 1 : 0));
    maskBuffer = u8.buffer;
  }

  return {
    encoding: "nullable",
    values,
    mask: maskBuffer,
  };
}
