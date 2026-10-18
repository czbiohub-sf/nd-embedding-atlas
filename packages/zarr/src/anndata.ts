/**
 * AnnData: convention detector, parser, and public class.
 *
 * Opening an AnnData store reads metadata only: obs/var frame metadata and
 * obsm shapes. Frame values, sparse matrices and gene columns are read by
 * DuckDB through the duckdb-zarr extension (`source` + `groupPath` name the
 * store for `read_zarr`). This class keeps the reads DuckDB can't do well
 * yet: single obsm columns for the scatter and single columns of a dense X.
 */

import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import * as zarr from "zarrita";
import type { Readable } from "zarrita";
import { readFrameMeta } from "./frame-meta.ts";
import type { FrameMeta, ParsedAnnData } from "./types.ts";
import { extractStore } from "./zarr-boundary.ts";

type ZarrGroup = zarr.Group<Readable>;

const EMPTY_FRAME: FrameMeta = { indexName: "_index", columns: [], encodings: {}, length: 0 };

// ─── Convention detector + parser ───────────────────────────────────────────

export function detectAnnData(rootAttrs: Record<string, unknown>): boolean {
  return rootAttrs["encoding-type"] === "anndata";
}

export async function parseAnnData(
  group: ZarrGroup,
  location: { storePath?: string; source?: string; groupPath?: string } = {},
): Promise<ParsedAnnData> {
  const obs = await readFrameMeta(group, "obs");
  if (!obs) throw new Error("AnnData store has no obs group");
  return {
    kind: "anndata",
    obs,
    var: await readFrameMeta(group, "var"),
    attrs: group.attrs ?? {},
    group,
    storePath: location.storePath,
    source: location.source,
    groupPath: location.groupPath ?? "",
  };
}

// ─── Public class ────────────────────────────────────────────────────────────

/** How a matrix (X or a layer) is stored. */
export type MatrixFormat = "dense" | "csr" | "csc";

/**
 * Shared contract implemented by both `AnnData` and `MuData`. The server
 * types against this for ops that don't care about modality structure
 * (discovery, embedding load, DuckDB ingest). Callers that need modality
 * structure narrow via `handle.kind === "mudata"`.
 */
export interface DatasetHandle {
  readonly kind: "anndata" | "mudata";
  readonly obs: FrameMeta;
  readonly var: FrameMeta;
  readonly nObs: number;
  /** The path or URL `read_zarr` reads; undefined for an in-memory store. */
  readonly source: string | undefined;
  listObsmKeys(): Promise<string[] | null>;
  /** Metadata-only shape of obsm/<name>; returns [nRows, nCols]. */
  getObsmShape(name: string): Promise<readonly [number, number]>;
  /**
   * Load one column of an obsm embedding (length-nObs Float32 aligned to
   * this handle's obs order). Cheaper than a full read for high-dim sources.
   */
  getObsmColumn(name: string, colIndex: number, signal?: AbortSignal): Promise<Float32Array>;
}

export class AnnData implements DatasetHandle {
  readonly kind = "anndata" as const;
  readonly obs: FrameMeta;
  readonly var: FrameMeta;
  readonly source: string | undefined;
  /** Group inside the store: "" at the root, `mod/<name>` for a MuData modality. */
  readonly groupPath: string;
  private readonly _group: ZarrGroup;
  private readonly _storePath: string | undefined;

  constructor(parsed: ParsedAnnData) {
    this.obs = parsed.obs;
    this.var = parsed.var ?? EMPTY_FRAME;
    this.source = parsed.source;
    this.groupPath = parsed.groupPath;
    this._group = parsed.group as ZarrGroup;
    this._storePath = parsed.storePath;
  }

  /** Build from a parsed AnnData result. For MuData, use `MuData.from`. */
  static from(parsed: ParsedAnnData): AnnData {
    return new AnnData(parsed);
  }

  get shape(): readonly [number, number] {
    return [this.obs.length, this.var.length];
  }

  get nObs(): number {
    return this.obs.length;
  }

  get nVars(): number {
    return this.var.length;
  }

  // ── Matrices ──────────────────────────────────────────────────────────

  /** How `X` or `layers/<name>` is stored, or null if it doesn't exist. */
  async matrixFormat(path: string): Promise<MatrixFormat | null> {
    try {
      const node = await zarr.open(this._group.resolve(path));
      if (node instanceof zarr.Array) return "dense";
      const encoding = node.attrs["encoding-type"];
      return encoding === "csr_matrix" ? "csr" : encoding === "csc_matrix" ? "csc" : null;
    } catch {
      return null;
    }
  }

  /** Column `j` of a dense matrix (`X` or `layers/<name>`), one value per obs. */
  async readDenseColumn(path: string, j: number): Promise<Float64Array> {
    const arr = await zarr.open(this._group.resolve(path), { kind: "array" });
    const { data } = await zarr.get(arr, [null, j]);
    return Float64Array.from(data as ArrayLike<number>);
  }

  /**
   * Layer names. Zarrita has no group listing, so this reads the `layers`
   * group's `layers` attr when a writer recorded one.
   */
  async layerNames(): Promise<string[]> {
    try {
      const layers = await zarr.open(this._group.resolve("layers"), { kind: "group" });
      const listed = layers.attrs.layers;
      return Array.isArray(listed) ? listed.filter((l): l is string => typeof l === "string") : [];
    } catch {
      return [];
    }
  }

  // ── Embeddings ────────────────────────────────────────────────────────

  /**
   * List the embedding keys present under `obsm/`.
   *
   * Strategy (most-portable first):
   *   1. Wrap the backing store with `withConsolidatedMetadata`: reads
   *      `.zmetadata` (v2) or `consolidated_metadata` in `zarr.json` (v3).
   *      AnnData-Python writes consolidated metadata by default, so this
   *      covers most on-disk and HTTP-hosted AnnData stores in one request.
   *   2. Fall back to filesystem `readdir` when we have a local store path.
   *   3. Return `null` so callers can probe a known-names list (no
   *      generic store listing exists in the Zarr spec).
   *
   * Each candidate is validated as a real 2-D numeric array: 1-D arrays,
   * bool columns, and scalar entries are dropped. This matches the actual
   * embedding shape, and (on MuData stores) skips `obsm/<modName>`: that's
   * the obs-to-modality binary mapping, not an embedding.
   */
  async listObsmKeys(): Promise<string[] | null> {
    const candidates = (await this._listObsmKeysConsolidated()) ?? (await this._listObsmKeysReaddir());
    if (!candidates) return null;
    const validated: string[] = [];
    for (const key of candidates) {
      if (await this._isValidEmbedding(key)) validated.push(key);
    }
    return validated;
  }

  /** True if `obsm/<name>` is a numeric 2-D array with ≥ 2 columns. */
  private async _isValidEmbedding(name: string): Promise<boolean> {
    try {
      const arr = await this._openObsmArray(name);
      if (arr.shape.length !== 2 || arr.shape[1] < 2) return false;
      return /^(float|int|uint)/.test(arr.dtype);
    } catch {
      return false;
    }
  }

  private async _listObsmKeysConsolidated(): Promise<string[] | null> {
    try {
      const store = extractStore(this._group);
      if (!store) return null;
      const listable = await zarr.withConsolidatedMetadata(store);
      const groupPath = this._group.path.endsWith("/") ? this._group.path : `${this._group.path}/`;
      const obsmPrefix = `${groupPath}obsm/`;
      const keys = new Set<string>();
      for (const entry of listable.contents()) {
        if (!entry.path.startsWith(obsmPrefix)) continue;
        // Arrays show as "obsm/X_umap"; groups show their children at deeper paths.
        const first = entry.path.slice(obsmPrefix.length).split("/")[0];
        if (first) keys.add(first);
      }
      return [...keys].toSorted();
    } catch {
      // No consolidated metadata available: let caller try the next strategy.
      return null;
    }
  }

  private async _listObsmKeysReaddir(): Promise<string[] | null> {
    if (!this._storePath) return null;
    const obsmDir = join(this._storePath, "obsm");
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
        if (!(await stat(full)).isDirectory()) continue;
        const contents = await readdir(full);
        if (contents.some((f) => f === ".zarray" || f === ".zgroup" || f === "zarr.json")) keys.push(entry);
      } catch {
        /* skip unreadable entries */
      }
    }
    return keys.toSorted();
  }

  /** `obsm/<name>` as a zarr array (an `encoding-type: array` group wraps the same array). */
  private _openObsmArray(name: string) {
    return zarr.open(this._group.resolve(`obsm/${name}`), { kind: "array" });
  }

  /**
   * Metadata-only shape read for obsm/<name>. Returns [nRows, nCols]
   * without loading any data. Used by SliceLoader to validate colIndex
   * without incurring a full matrix read.
   */
  async getObsmShape(name: string): Promise<readonly [number, number]> {
    const arr = await this._openObsmArray(name);
    if (arr.shape.length !== 2) {
      throw new Error(`obsm/${name} must be 2-D (got shape ${arr.shape.join("×")})`);
    }
    return [arr.shape[0], arr.shape[1]] as const;
  }

  /**
   * Load a single column of an obsm embedding as a Float32Array of length nObs.
   *
   * Uses zarrita's fancy indexing (`[null, colIndex]`) to pull one stride
   * instead of the full matrix: for 1024-dim embeddings this drops the
   * read from ~115 MB to ~224 KB. Cancellation is cooperative:
   * `signal.aborted` is checked before and after the zarr fetch.
   */
  async getObsmColumn(name: string, colIndex: number, signal?: AbortSignal): Promise<Float32Array> {
    const [nRows, nCols] = await this.getObsmShape(name);
    if (colIndex < 0 || colIndex >= nCols) {
      throw new Error(`colIndex ${colIndex} out of range [0, ${nCols}) for obsm/${name}`);
    }
    if (signal?.aborted) throw signal.reason ?? new Error("Aborted");
    const { data } = await zarr.get(await this._openObsmArray(name), [null, colIndex]);
    if (signal?.aborted) throw signal.reason ?? new Error("Aborted");
    const col = data instanceof Float32Array ? data : Float32Array.from(data as ArrayLike<number>);
    if (col.length !== nRows) throw new Error(`getObsmColumn: expected ${nRows} values, got ${col.length}`);
    return col;
  }
}
