import { describe, expect, test } from "vite-plus/test";
import { rowIndex } from "@ndea/sdk";
import { stringPredicate } from "../../helpers";
import { hasFilterPredicate, predicateMaskRows, predicateRowIndexQuery } from "./usePredicateRowIndices";

describe("predicate row-index query", () => {
  test("uses an empty valid query for cleared predicates", () => {
    expect(hasFilterPredicate(null)).toBe(false);
    expect(hasFilterPredicate([])).toBe(false);
    expect(hasFilterPredicate("   ")).toBe(false);
    expect(hasFilterPredicate(true)).toBe(false);
    expect(hasFilterPredicate(stringPredicate("null"))).toBe(false);
    expect(hasFilterPredicate(stringPredicate("true"))).toBe(false);
    expect(predicateRowIndexQuery("dataset", []).toString()).toContain("WHERE FALSE");
  });

  test("queries row IDs for active and zero-match predicates", () => {
    const active = predicateRowIndexQuery("dataset", stringPredicate('"score" > 3'));
    expect(active?.toString()).toContain('"__row_index__" AS "rowIndex"');
    expect(active?.toString()).toContain('"score" > 3');

    const zeroMatch = predicateRowIndexQuery("dataset", false);
    expect(hasFilterPredicate(false)).toBe(true);
    expect(zeroMatch?.toString()).toContain("WHERE FALSE");
  });

  test("preserves inactive null versus active-empty GPU mask semantics", () => {
    expect(predicateMaskRows(false, [rowIndex(4)])).toBeNull();
    expect(predicateMaskRows(true, [])).toEqual([]);
    expect(predicateMaskRows(true, [rowIndex(4)])).toEqual([rowIndex(4)]);
  });
});
