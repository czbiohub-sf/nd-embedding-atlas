/**
 * IPointSet — uniform interface over dense and sparse point-index sets.
 *
 * Two implementations:
 *  - DensePointSet (typedfastbitset): for isolation layers (dense coverage)
 *  - SparsePointSet (sorted number[]): for selection layers (lasso, cross-panel)
 *
 * IMPORTANT: expandToMaskArray is O(numPoints) expansion, NOT zero-copy.
 * typedfastbitset stores 1 bit/point (N/32 words); GPU buffer needs 1 u32/point.
 * These layouts are incompatible — the expansion pass is mandatory.
 */
export interface IPointSet {
  /** Number of selected points in this set. */
  readonly size: number;

  /**
   * Expand to a per-point GPU mask buffer.
   * out[i] = 1 if point i is selected, 0 otherwise.
   * out.length MUST equal numPoints. Method fills the entire array.
   * O(numPoints) — not zero-copy.
   */
  expandToMaskArray(out: Uint32Array): void;

  /**
   * Return selected point indices (0-based GPU buffer positions).
   * Used for cross-panel broadcast path after row-index mapping.
   */
  toPointIndices(): number[];

  /** O(1) membership test. */
  has(pointIndex: number): boolean;
}
