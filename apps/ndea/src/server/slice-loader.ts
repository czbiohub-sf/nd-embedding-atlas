/**
 * ObsmSliceLoader — lazy, column-wise reader for obsm embeddings.
 *
 * Wraps one or more `DatasetHandle`s (AnnData or MuData modality) and
 * exposes `loadColumn(colIndex)` returning a Float32Array of length nObs
 * aligned to obs_base row order. Multi-dataset concat happens inside the
 * loader: chunks are stitched in insertion order (same semantics as the
 * pre-slice-cache path in `routes/embeddings.ts`).
 *
 * Abort semantics are cooperative: `signal.aborted` is checked around
 * each zarr read. A partial read is never cached — the full column is
 * built into an intermediate buffer and only written to the cache on
 * success.
 */
import type { DatasetHandle } from "@ndea/zarr";

export interface SliceLoader {
  /** Returns one dense column of length `nObs`, aligned to obs_base row order. */
  loadColumn(colIndex: number, signal?: AbortSignal): Promise<Float32Array>;
  /** Width of the source matrix. For obsm = nDims. */
  readonly width: number;
}

/**
 * Per-(obsm key, dataset-set) loader.
 *
 * `accessors` is the ordered list of `(name, handle)` pairs matching
 * `ViewerState.accessors.entries()`. Row ordering in the output matches
 * the insertion order of obs_base.
 */
export class ObsmSliceLoader implements SliceLoader {
  readonly width: number;
  private readonly accessors: (readonly [string, DatasetHandle])[];
  private readonly obsmKey: string;
  private readonly cache = new Map<number, Float32Array>();
  private readonly inflight = new Map<number, Promise<Float32Array>>();

  constructor(obsmKey: string, accessors: Iterable<readonly [string, DatasetHandle]>, width: number) {
    this.obsmKey = obsmKey;
    this.accessors = [...accessors];
    this.width = width;
  }

  /**
   * Discover the width (nDims) of an obsm key via zarr metadata only.
   * No data read — reads `.zarray` / `zarr.json` shape from the first
   * accessor that carries the key.
   */
  static async detectWidth(obsmKey: string, accessors: Iterable<readonly [string, DatasetHandle]>): Promise<number> {
    let lastErr: unknown;
    for (const [, handle] of accessors) {
      try {
        const shape = await handle.getObsmShape(obsmKey);
        return shape[1];
      } catch (err) {
        lastErr = err;
      }
    }
    const msg = lastErr instanceof Error ? `: ${lastErr.message}` : "";
    throw new Error(`detectWidth: no accessor carries obsm key "${obsmKey}"${msg}`);
  }

  loadColumn(colIndex: number, signal?: AbortSignal): Promise<Float32Array> {
    if (colIndex < 0 || colIndex >= this.width) {
      return Promise.reject(
        new Error(
          `ObsmSliceLoader("${this.obsmKey}").loadColumn: colIndex ${colIndex} out of range [0, ${this.width})`,
        ),
      );
    }
    const cached = this.cache.get(colIndex);
    if (cached) return Promise.resolve(cached);

    const pending = this.inflight.get(colIndex);
    if (pending) return pending;

    const promise = this._readColumn(colIndex, signal).finally(() => {
      this.inflight.delete(colIndex);
    });
    this.inflight.set(colIndex, promise);
    return promise;
  }

  private async _readColumn(colIndex: number, signal: AbortSignal | undefined): Promise<Float32Array> {
    const chunks: Float32Array[] = [];
    let totalLength = 0;

    for (const [dsName, handle] of this.accessors) {
      if (signal?.aborted) throw signal.reason ?? new Error("Aborted");
      try {
        const col = await handle.getObsmColumn(this.obsmKey, colIndex, signal);
        chunks.push(col);
        totalLength += col.length;
      } catch (err) {
        if (signal?.aborted) throw signal.reason ?? err;
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`ObsmSliceLoader: failed to read ${this.obsmKey}[${colIndex}] from "${dsName}": ${msg}`, {
          cause: err,
        });
      }
    }

    if (signal?.aborted) throw signal.reason ?? new Error("Aborted");

    const out = new Float32Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }

    // Only cache on success (avoids stale partial data if upstream retries).
    this.cache.set(colIndex, out);
    return out;
  }

  /** Drop all cached columns. Called on dataset unload. */
  evict(): void {
    this.cache.clear();
    this.inflight.clear();
  }
}
