/**
 * Core types for the vendored zarr reader.
 *
 * Trimmed to exactly what nd-embedding-atlas consumes: AnnData / MuData /
 * OME-Zarr detection, parsed-store results, and obs/var frame metadata.
 * Frame values are read by DuckDB (the duckdb-zarr extension), not here.
 *
 * Consumers branch on `ParsedStore.kind` for convention-specific handling.
 */

/**
 * One obs/var data frame, from metadata only: no column values are read.
 */
export interface FrameMeta {
  /** Name of the index array (the frame's `_index` attr). */
  readonly indexName: string;
  /** Column names in `column-order`. */
  readonly columns: readonly string[];
  /** Each column's anndata `encoding-type` (`array` for a plain array). */
  readonly encodings: Readonly<Record<string, string>>;
  /** Row count, from the index array's shape. */
  readonly length: number;
}

// ─── ParsedStore: discriminated result of open() ───────────────────────────

/** Opaque zarrita Group handle. Parsers hold it; public classes don't expose it. */
export type ZarrGroupHandle = unknown;

export interface ParsedAnnData {
  readonly kind: "anndata";
  readonly obs: FrameMeta;
  readonly var: FrameMeta | undefined;
  readonly attrs: Record<string, unknown>;
  readonly group: ZarrGroupHandle;
  readonly storePath: string | undefined;
  /** The path or URL `open()` was given; what DuckDB's `read_zarr` reads. */
  readonly source: string | undefined;
  /** Group of this AnnData inside the store: "" at the root, `mod/<name>` in a MuData. */
  readonly groupPath: string;
}

export interface ParsedMuData {
  readonly kind: "mudata";
  readonly obs: FrameMeta | undefined;
  readonly var: FrameMeta | undefined;
  readonly attrs: Record<string, unknown>;
  readonly group: ZarrGroupHandle;
  readonly storePath: string | undefined;
  readonly source: string | undefined;
  readonly modalities: ReadonlyMap<string, ParsedAnnData>;
}

export interface ParsedOmeZarr {
  readonly kind: "ome-zarr";
  readonly attrs: Record<string, unknown>;
  readonly group: ZarrGroupHandle;
  readonly storePath: string | undefined;
  /** `multiscales[0].axes` from root `.zattrs`. */
  readonly multiscales: readonly unknown[];
}

export type ParsedStore = ParsedAnnData | ParsedMuData | ParsedOmeZarr;
