import { describe, expect, test } from "bun:test";

import { tableCacheKey, tableFilterState } from "./useTableQuery";

function selection(predicate: unknown) {
  return { predicate: () => predicate } as never;
}

const peerPredicate = { toString: () => "\"class\" = 'A'" };

describe("tableFilterState", () => {
  test("uses one selection predicate for cache invalidation and page SQL", () => {
    const cleared = tableFilterState(selection(null));
    const peerFiltered = tableFilterState(selection(peerPredicate));

    expect(cleared).toEqual({ key: "null", whereClause: "" });
    expect(peerFiltered.key).not.toBe(cleared.key);
    expect(peerFiltered.whereClause).toContain("WHERE");
    expect(peerFiltered.whereClause).toContain("class");
  });

  test("preserves active-empty instead of treating it as cleared", () => {
    const activeEmpty = tableFilterState(selection(false));

    expect(activeEmpty.key).toBe("false");
    expect(activeEmpty.whereClause).toBe("WHERE FALSE");
  });

  test("resolved revision invalidates pages even when predicate SQL is unchanged", () => {
    const stableSelection = selection(peerPredicate);

    expect(tableCacheKey(stableSelection, 4)).not.toBe(tableCacheKey(stableSelection, 5));
  });
});
