import { describe, expect, test } from "bun:test";
import { stringPredicate } from "../../helpers";
import { hasFilterPredicate, predicateBitsQuery, scatterWords } from "./usePredicateBits";

describe("predicate bitmask query", () => {
  test("uses an empty valid query for cleared predicates", () => {
    expect(hasFilterPredicate(null)).toBe(false);
    expect(hasFilterPredicate([])).toBe(false);
    expect(hasFilterPredicate("   ")).toBe(false);
    expect(hasFilterPredicate(true)).toBe(false);
    expect(hasFilterPredicate(stringPredicate("null"))).toBe(false);
    expect(hasFilterPredicate(stringPredicate("true"))).toBe(false);
    expect(predicateBitsQuery("dataset", []).toString()).toContain("WHERE FALSE");
  });

  test("groups matching rows into 32-row words for active and zero-match predicates", () => {
    const active = predicateBitsQuery("dataset", stringPredicate('"score" > 3')).toString();
    expect(active).toContain('(__row_index__ // 32)::UINTEGER AS "w"');
    expect(active).toContain('bit_or(1::UBIGINT << (__row_index__ % 32)::INTEGER)::UINTEGER AS "bits"');
    expect(active).toContain('"score" > 3');
    expect(active).toContain('GROUP BY "w"');

    expect(hasFilterPredicate(false)).toBe(true);
    expect(predicateBitsQuery("dataset", false).toString()).toContain("WHERE FALSE");
  });

  test("scatters sparse words into a bit layer", () => {
    // Rows 0, 33 and 95 (bit 31 of word 2); word 1 bit 1 = row 33.
    const words = scatterWords(new Uint32Array([2, 0, 1]), new Uint32Array([0x8000_0000, 1, 2]));
    expect([...words]).toEqual([1, 2, 0x8000_0000]);
    expect(scatterWords([], [])).toEqual(new Uint32Array(0));
  });
});
