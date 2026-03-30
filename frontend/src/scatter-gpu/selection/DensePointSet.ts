import type { IPointSet } from "./IPointSet";
import TypedFastBitSet from "typedfastbitset";

/**
 * DensePointSet — bitset-backed set for isolation layers.
 *
 * Suitable when a large fraction of points may be selected (e.g. "all B cells").
 * expandToMaskArray performs an O(numPoints) expansion: zeros the buffer then
 * sets a 1 for each bit that is set in the bitset. The bitset stores
 * ceil(numPoints/32) words; the GPU mask needs numPoints u32 values.
 */
export class DensePointSet implements IPointSet {
  private readonly bitset: TypedFastBitSet;
  private readonly _numPoints: number;

  constructor(numPoints: number, selectedIndices?: number[]) {
    this.bitset = selectedIndices
      ? new TypedFastBitSet(selectedIndices)
      : new TypedFastBitSet();
    this._numPoints = numPoints;
  }

  get size(): number {
    return this.bitset.size();
  }

  expandToMaskArray(out: Uint32Array): void {
    // O(numPoints) fill then O(selected) set.
    // Do NOT pass bitset.words directly to GPU — different layouts.
    out.fill(0);
    this.bitset.forEach((i: number) => {
      if (i >= 0 && i < out.length) out[i] = 1;
    });
  }

  toPointIndices(): number[] {
    return this.bitset.array();
  }

  has(pointIndex: number): boolean {
    return this.bitset.has(pointIndex);
  }

  /** Add a single point index. */
  add(index: number): void {
    this.bitset.add(index);
  }

  /** Clear all points. */
  clear(): void {
    this.bitset.clear();
  }

  /** Populate from an array of point indices. Clears existing state. */
  setFromIndices(indices: number[]): void {
    this.bitset.clear();
    for (const i of indices) this.bitset.add(i);
  }

  /**
   * Populate from category membership.
   * For each point i: if isolatedCategories.has(categoryIndices[i]), set bit i.
   */
  setFromCategories(
    isolatedCategories: Set<number>,
    categoryIndices: Uint8Array,
  ): void {
    this.bitset.clear();
    const n = Math.min(categoryIndices.length, this._numPoints);
    for (let i = 0; i < n; i++) {
      if (isolatedCategories.has(categoryIndices[i])) {
        this.bitset.add(i);
      }
    }
  }

  get numPoints(): number {
    return this._numPoints;
  }
}
