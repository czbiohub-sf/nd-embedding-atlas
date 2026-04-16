import type { CategoricalArray, NullableArray, Scalar } from "./types.ts";

/**
 * Categorical array from AnnData's codes + categories pattern.
 * Iterable — supports iterator helpers: cat.filter(v => v !== null).take(10)
 */
export class SimpleCategorical implements CategoricalArray {
  readonly categories: readonly Scalar[];
  readonly codes: Int8Array | Int16Array | Int32Array;
  readonly ordered: boolean;
  readonly length: number;

  constructor(
    categories: readonly Scalar[],
    codes: Int8Array | Int16Array | Int32Array,
    ordered = false,
  ) {
    this.categories = categories;
    this.codes = codes;
    this.ordered = ordered;
    this.length = codes.length;
  }

  at(i: number): Scalar | null {
    const code = this.codes[i];
    if (code === -1) return null;
    return this.categories[code];
  }

  toArray(): (Scalar | null)[] {
    return Array.from(this);
  }

  *[Symbol.iterator](): IterableIterator<Scalar | null> {
    for (let i = 0; i < this.length; i++) {
      yield this.at(i);
    }
  }
}

/**
 * Nullable array from AnnData's values + mask pattern.
 * Iterable — supports iterator helpers: nullable.filter(v => v !== null)
 */
export class SimpleNullable implements NullableArray {
  readonly values: ArrayLike<Scalar>;
  readonly mask: Uint8Array;
  readonly length: number;

  constructor(values: ArrayLike<Scalar>, mask: Uint8Array) {
    this.values = values;
    this.mask = mask;
    this.length = mask.length;
  }

  at(i: number): Scalar | null {
    if (this.mask[i]) return null;
    return this.values[i];
  }

  *[Symbol.iterator](): IterableIterator<Scalar | null> {
    for (let i = 0; i < this.length; i++) {
      yield this.at(i);
    }
  }
}
