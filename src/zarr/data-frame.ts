/**
 * DataFrame — obs/var surface for the AnnData class.
 *
 * Wraps the existing `AnnDataFrame` (column-major map) and exposes a stable
 * tabular surface. `toArrow()` is the hot path; downstream consumers always
 * take the Arrow Table and hand it to DuckDB's Appender.
 */

import type { Table as ArrowTable } from "@uwdata/flechette";
import type { AnnDataFrame, ColumnData } from "./types.ts";
import { toArrowTable } from "./to-arrow.ts";

export interface DataFrame {
  readonly length: number;
  readonly columns: readonly string[];
  readonly index: readonly string[] | Int32Array;
  readonly indexName: string;
  getColumn(name: string): ColumnData | undefined;
  toArrow(): ArrowTable;
}

/**
 * Lazy adapter over `AnnDataFrame`. No data copy; `toArrow()` builds the
 * Arrow Table on demand (today it's materialized by `toArrowTable`; can swap
 * for a streaming builder later without breaking callers).
 */
export class LazyDataFrame implements DataFrame {
  private readonly _source: AnnDataFrame;
  private _arrow: ArrowTable | undefined;
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

  toArrow(): ArrowTable {
    this._arrow ??= toArrowTable(this._source) as unknown as ArrowTable;
    return this._arrow;
  }

  /** Underlying AnnDataFrame — escape hatch for consumers that still need it. */
  get source(): AnnDataFrame {
    return this._source;
  }
}
