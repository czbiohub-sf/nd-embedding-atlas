/**
 * DataFrame: obs/var surface for the AnnData class.
 *
 * Wraps the existing `AnnDataFrame` (column-major map) and exposes a stable
 * tabular surface; `ingestDataFrames` (duckdb-ingest.ts) appends its columns
 * to DuckDB.
 */

import type { AnnDataFrame, ColumnData } from "./types.ts";

/** Lazy adapter over `AnnDataFrame`. No data copy. */
export class LazyDataFrame {
  private readonly _source: AnnDataFrame;
  readonly indexName: string;

  constructor(source: AnnDataFrame, indexName = "_index") {
    this._source = source;
    this.indexName = indexName;
  }

  get length(): number {
    const idx = this._source.index;
    return Array.isArray(idx) ? idx.length : idx.length;
  }

  get columns(): readonly string[] {
    return this._source.columnOrder;
  }

  get index(): readonly string[] | Int32Array {
    return this._source.index;
  }

  getColumn(name: string): ColumnData | undefined {
    return this._source.column(name);
  }

  /** Underlying AnnDataFrame: escape hatch for consumers that still need it. */
  get source(): AnnDataFrame {
    return this._source;
  }
}
