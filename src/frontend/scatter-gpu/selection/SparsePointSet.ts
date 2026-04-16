import type { IPointSet } from "./IPointSet";

/**
 * SparsePointSet — sorted array-backed set for selection layers.
 *
 * Used for lasso readback results and cross-panel broadcast where the
 * selected fraction is typically <5% of total points.
 *
 * NOTE: indices here are GPU buffer point indices (0-based), NOT DuckDB
 * __row_index__ values. The rowIndicesRef mapping must happen BEFORE
 * constructing a SparsePointSet that will be broadcast cross-panel.
 */
export class SparsePointSet implements IPointSet {
  private readonly _indices: number[];
  private readonly _set: Set<number>;

  constructor(pointIndices: number[]) {
    this._indices = pointIndices;
    this._set = new Set(pointIndices);
  }

  get size(): number {
    return this._indices.length;
  }

  expandToMaskArray(out: Uint32Array): void {
    out.fill(0);
    for (const i of this._indices) {
      if (i >= 0 && i < out.length) out[i] = 1;
    }
  }

  toPointIndices(): number[] {
    return this._indices;
  }

  has(pointIndex: number): boolean {
    return this._set.has(pointIndex);
  }

  static empty(): SparsePointSet {
    return new SparsePointSet([]);
  }
}
