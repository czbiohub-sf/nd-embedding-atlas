import type { SelectionCombine } from "./contracts";

/** Row-order bitmasks (bit r & 31 of word r >> 5 = row r) over the same rows. */

/** The new selection after a drawn shape meets the current one (`prev` null = nothing selected). */
export function combineSelection(
  prev: Uint32Array | null,
  shape: Uint32Array<ArrayBuffer>,
  combine: SelectionCombine,
): Uint32Array<ArrayBuffer> {
  if (combine === "replace") return shape;
  if (!prev) return combine === "add" ? shape : new Uint32Array(shape.length);
  const out = new Uint32Array(shape.length);
  for (let w = 0; w < out.length; w++) {
    const p = prev[w] ?? 0;
    out[w] = combine === "add" ? p | shape[w] : p & ~shape[w];
  }
  return out;
}

/** Every one of `rows` rows not in `bits`; padding bits past the last row stay 0. */
export function invertSelection(bits: Uint32Array, rows: number): Uint32Array<ArrayBuffer> {
  const out = new Uint32Array(Math.ceil(rows / 32));
  for (let w = 0; w < out.length; w++) out[w] = ~(bits[w] ?? 0);
  const tail = rows & 31;
  if (tail) out[out.length - 1] &= (1 << tail) - 1;
  return out;
}

export function isEmptySelection(bits: Uint32Array): boolean {
  return bits.every((w) => w === 0);
}
