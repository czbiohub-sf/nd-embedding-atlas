/**
 * BunFileStore — zarrita `AsyncReadable` backed by `Bun.file`.
 *
 * Replaces `@zarrita/storage/fs` which wraps `node:fs/promises`. Bun.file is
 * zero-copy on darwin/linux for typical chunk sizes and exposes `.slice()` for
 * eventual v3 sharded-store partial reads without allocating the whole shard.
 *
 * Shape matches zarrita's `AsyncReadable` — keys are absolute (`/obs/.zarray`)
 * and resolve under the constructor `root`.
 */

import path from "node:path";

/**
 * Byte-range query. Matches zarrita's `@zarrita/storage` contract:
 *
 * - `{offset, length}` — classic range request.
 * - `{suffixLength}` — last N bytes. Used by v3 sharded codec to read the
 *   shard index from the tail of the shard file before any chunk fetch.
 */
export type RangeQuery = { offset: number; length: number } | { suffixLength: number };

export interface AsyncReadable {
  get(key: string, opts?: unknown): Promise<Uint8Array | undefined>;
  getRange?(key: string, range: RangeQuery): Promise<Uint8Array | undefined>;
}

export class BunFileStore implements AsyncReadable {
  readonly root: string;

  constructor(root: string) {
    // Normalize so "/a/b/" and "/a/b" resolve the same child paths.
    this.root = root.replace(/\/+$/, "");
  }

  async get(key: string): Promise<Uint8Array | undefined> {
    const file = Bun.file(this._resolve(key));
    if (!(await file.exists())) return undefined;
    const buf = await file.arrayBuffer();
    return new Uint8Array(buf);
  }

  /**
   * Byte-range read. Used by v3 sharded arrays — the sharding codec issues
   * `{suffixLength}` to grab the shard index from the file tail, then
   * `{offset, length}` for individual chunk slices within the shard.
   */
  async getRange(key: string, range: RangeQuery): Promise<Uint8Array | undefined> {
    const file = Bun.file(this._resolve(key));
    if (!(await file.exists())) return undefined;

    let slice: Blob;
    if ("suffixLength" in range) {
      // Negative start on Blob.slice counts from the end, per the Fetch spec.
      slice = file.slice(-range.suffixLength);
    } else {
      slice = file.slice(range.offset, range.offset + range.length);
    }
    const buf = await slice.arrayBuffer();
    return new Uint8Array(buf);
  }

  /** Stream a file — reserved for future large-array reads. */
  async stream(key: string): Promise<ReadableStream<Uint8Array> | undefined> {
    const file = Bun.file(this._resolve(key));
    if (!(await file.exists())) return undefined;
    return file.stream();
  }

  exists(key: string): Promise<boolean> {
    return Bun.file(this._resolve(key)).exists();
  }

  private _resolve(key: string): string {
    // Zarrita emits keys like "/obs/.zarray". Strip leading slash before joining.
    const rel = key.startsWith("/") ? key.slice(1) : key;
    return path.join(this.root, rel);
  }
}

/**
 * Open a `Readable` for a local filesystem path or an HTTP(S) URL.
 * Returns a store zarrita's `zarr.open()` accepts.
 */
export async function openBunStore(location: string): Promise<{
  store: AsyncReadable;
  rootPath: string | undefined;
}> {
  if (location.startsWith("http://") || location.startsWith("https://")) {
    const { FetchStore } = await import("zarrita");
    // FetchStore implements the same .get(key) contract as AsyncReadable.
    return { store: new FetchStore(location) as unknown as AsyncReadable, rootPath: undefined };
  }
  return { store: new BunFileStore(location), rootPath: location };
}
