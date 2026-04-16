import type { CoordArray, CoordSet, DimName, Dtype, Scalar, Slice } from "./types.ts";

/**
 * CoordArray backed by a typed array or string array.
 * Implements Symbol.iterator for iterator helper support (.map, .filter, .take).
 */
export class SimpleCoordArray implements CoordArray {
  readonly dim: DimName;
  readonly values: ArrayLike<Scalar>;
  readonly dtype: Dtype;
  readonly attrs: Record<string, unknown>;
  readonly length: number;

  private _sorted: boolean | null = null;

  constructor(dim: DimName, values: ArrayLike<Scalar>, dtype: Dtype, attrs: Record<string, unknown> = {}) {
    this.dim = dim;
    this.values = values;
    this.dtype = dtype;
    this.attrs = attrs;
    this.length = values.length;
  }

  indexOf(label: Scalar): number {
    if (this.isSorted() && (typeof label === "number" || typeof label === "bigint")) {
      return this.binarySearch(label);
    }
    for (let i = 0; i < this.length; i++) {
      if (this.values[i] === label) return i;
    }
    return -1;
  }

  labelSlice(start: Scalar, stop: Scalar): Slice {
    const startIdx = this.indexOf(start);
    const stopIdx = this.indexOf(stop);
    if (startIdx === -1 || stopIdx === -1) {
      throw new Error(`Label range [${String(start)}, ${String(stop)}] not found in coord "${this.dim}"`);
    }
    return { start: startIdx, stop: stopIdx + 1 };
  }

  *[Symbol.iterator](): IterableIterator<Scalar> {
    for (let i = 0; i < this.length; i++) {
      yield this.values[i];
    }
  }

  private isSorted(): boolean {
    if (this._sorted !== null) return this._sorted;
    if (this.length === 0) {
      this._sorted = true;
      return true;
    }
    // Support both number and bigint typed arrays for binary search
    const first = this.values[0];
    if (typeof first !== "number" && typeof first !== "bigint") {
      this._sorted = false;
      return false;
    }
    for (let i = 1; i < this.length; i++) {
      if ((this.values[i] as number | bigint) < (this.values[i - 1] as number | bigint)) {
        this._sorted = false;
        return false;
      }
    }
    this._sorted = true;
    return true;
  }

  private binarySearch(target: number | bigint): number {
    let lo = 0;
    let hi = this.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      const v = this.values[mid] as number | bigint;
      if (v === target) return mid;
      if (v < target) lo = mid + 1;
      else hi = mid - 1;
    }
    return -1;
  }
}

/**
 * CoordSet backed by a Map. Iterable — supports iterator helpers.
 */
export class SimpleCoordSet implements CoordSet {
  private _coords: Map<DimName, CoordArray>;

  constructor(coords?: Iterable<CoordArray>) {
    this._coords = new Map();
    if (coords) {
      for (const c of coords) {
        this._coords.set(c.dim, c);
      }
    }
  }

  get(dim: DimName): CoordArray | undefined {
    return this._coords.get(dim);
  }

  has(dim: DimName): boolean {
    return this._coords.has(dim);
  }

  dims(): DimName[] {
    return [...this._coords.keys()];
  }

  get size(): number {
    return this._coords.size;
  }

  [Symbol.iterator](): IterableIterator<CoordArray> {
    return this._coords.values();
  }
}
