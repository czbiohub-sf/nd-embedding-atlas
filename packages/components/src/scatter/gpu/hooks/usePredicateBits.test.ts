import { describe, expect, test } from "bun:test";
import { stringPredicate } from "../../../query/mosaic";
import { hasFilterPredicate, scatterWords } from "./usePredicateBits";

describe("predicate bitmask", () => {
  test("only predicates that can exclude rows are active", () => {
    expect(hasFilterPredicate(null)).toBe(false);
    expect(hasFilterPredicate([])).toBe(false);
    expect(hasFilterPredicate("   ")).toBe(false);
    expect(hasFilterPredicate(true)).toBe(false);
    expect(hasFilterPredicate(stringPredicate("null"))).toBe(false);
    expect(hasFilterPredicate(stringPredicate("true"))).toBe(false);
    expect(hasFilterPredicate(false)).toBe(true);
    expect(hasFilterPredicate(stringPredicate('"score" > 3'))).toBe(true);
  });

  test("scattered words set exactly the matching rows' bits", () => {
    // Query result: one (w, bits) row per non-empty 32-row word, in any order. Rows 0, 31 | 33 | 64, 95.
    const words = scatterWords([2, 0, 1], [0x8000_0001, 0x8000_0001, 0b10]);
    const set = Array.from({ length: 32 * words.length }, (_, r) => r).filter((r) => (words[r >>> 5] >>> (r & 31)) & 1);
    expect(set).toEqual([0, 31, 33, 64, 95]);
    expect(scatterWords([], [])).toEqual(new Uint32Array(0));
  });
});
