/**
 * Runtime helper classes for the zarr reader.
 *
 * `types.ts` holds pure interface/type shapes; this file holds the
 * concrete classes that implement them. Consolidated from `sparse.ts`
 * and `categorical.ts`.
 */

import type { CategoricalArray, Dtype, NullableArray, Scalar, SparseArray } from "./types.ts";

// ─── Sparse matrix (CSR / CSC) ──────────────────────────────────────────────

/**
 * CSR/CSC sparse matrix.
 *
 * Implements rows() iterator — supports iterator helpers:
 *   sparse.rows().filter(r => r.values.length > 0).take(100)
 */
export class CsrCscArray implements SparseArray {
  readonly shape: readonly [number, number];
  readonly format: "csr" | "csc";
  readonly data: Float32Array | Float64Array;
  readonly indices: Int32Array;
  readonly indptr: Int32Array;
  readonly dtype: Dtype;
  readonly nnz: number;

  constructor(opts: {
    shape: [number, number];
    format: "csr" | "csc";
    data: Float32Array | Float64Array;
    indices: Int32Array;
    indptr: Int32Array;
    dtype?: Dtype;
  }) {
    this.shape = opts.shape;
    this.format = opts.format;
    this.data = opts.data;
    this.indices = opts.indices;
    this.indptr = opts.indptr;
    this.dtype = opts.dtype ?? (opts.data instanceof Float32Array ? "float32" : "float64");
    this.nnz = opts.data.length;
  }

  row(i: number): { indices: Int32Array; values: Float32Array | Float64Array } {
    if (this.format !== "csr") {
      throw new Error("row() only supported on CSR matrices. Use col() for CSC.");
    }
    const start = this.indptr[i];
    const end = this.indptr[i + 1];
    return {
      indices: this.indices.subarray(start, end),
      values: this.data.subarray(start, end),
    };
  }

  col(j: number): { indices: Int32Array; values: Float32Array | Float64Array } {
    if (this.format !== "csc") {
      throw new Error("col() only supported on CSC matrices. Use row() for CSR.");
    }
    const start = this.indptr[j];
    const end = this.indptr[j + 1];
    return {
      indices: this.indices.subarray(start, end),
      values: this.data.subarray(start, end),
    };
  }

  sliceRows(start: number, end: number): SparseArray {
    if (this.format !== "csr") {
      throw new Error("sliceRows() only supported on CSR matrices");
    }
    const ptrStart = this.indptr[start];
    const ptrEnd = this.indptr[end];
    const newIndptr = new Int32Array(end - start + 1);
    for (let i = 0; i <= end - start; i++) {
      newIndptr[i] = this.indptr[start + i] - ptrStart;
    }
    return new CsrCscArray({
      shape: [end - start, this.shape[1]],
      format: "csr",
      data: this.data.subarray(ptrStart, ptrEnd),
      indices: this.indices.subarray(ptrStart, ptrEnd),
      indptr: newIndptr,
      dtype: this.dtype,
    });
  }

  /** Iterate rows (CSR) or columns (CSC) as sparse vectors. */
  *rows(): IterableIterator<{
    index: number;
    indices: Int32Array;
    values: Float32Array | Float64Array;
  }> {
    const n = this.format === "csr" ? this.shape[0] : this.shape[1];
    for (let i = 0; i < n; i++) {
      const start = this.indptr[i];
      const end = this.indptr[i + 1];
      yield {
        index: i,
        indices: this.indices.subarray(start, end),
        values: this.data.subarray(start, end),
      };
    }
  }
}

// ─── Categorical (AnnData codes + categories) ──────────────────────────────

/**
 * Categorical array from AnnData's codes + categories pattern.
 * Iterable — supports iterator helpers: cat.filter(v => v !== null).take(10)
 */
export class SimpleCategorical implements CategoricalArray {
  readonly categories: readonly Scalar[];
  readonly codes: Int8Array | Int16Array | Int32Array;
  readonly ordered: boolean;
  readonly length: number;

  constructor(categories: readonly Scalar[], codes: Int8Array | Int16Array | Int32Array, ordered = false) {
    this.categories = categories;
    this.codes = codes;
    this.ordered = ordered;
    this.length = codes.length;
  }

  at(i: number): Scalar | null {
    const code = this.codes[i];
    if (code === undefined || code === -1) return null;
    return this.categories[code] ?? null;
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

// ─── Nullable (values + validity mask) ─────────────────────────────────────

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
    return this.values[i] ?? null;
  }

  *[Symbol.iterator](): IterableIterator<Scalar | null> {
    for (let i = 0; i < this.length; i++) {
      yield this.at(i);
    }
  }
}
