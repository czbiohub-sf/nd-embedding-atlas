import { describe, expect, test } from "vite-plus/test";
import type { FilterClause } from "@ndea/protocol";
import { clearLasso, publishIsolationFilter, publishLasso, publishRangeFilter } from "./routing";
import type { FilterCoordinationAPI } from "@ndea/sdk";
import { Selection } from "@uwdata/mosaic-core";

function filterSpy(calls: unknown[]): FilterCoordinationAPI {
  return {
    selection: Selection.crossfilter(),
    getResolved: () => ({ predicate: null, revision: 0 }),
    subscribeResolved: () => () => {},
    publish: (facet, clause) => {
      calls.push(["publish", facet, clause]);
    },
    clear: (facet) => {
      calls.push(["clear", facet]);
    },
    materializeRowIds: async () => ({ rowIds: [], revision: 0 }),
  };
}

describe("Scatter filter routing", () => {
  test.each([
    [publishLasso, "lasso", { op: "inSet", set: "0123456789abcdef" }],
    [publishRangeFilter, "range", { op: "between", column: "score", range: [3, 7] }],
    [publishIsolationFilter, "isolation", { op: "in", column: "class", values: ["A"] }],
  ] as const)("publishes and clears %s", (publish, facet, value) => {
    const calls: unknown[] = [];
    const host = { filter: filterSpy(calls) };
    publish(host, value as FilterClause);
    publish(host, null);
    expect(calls).toEqual([
      ["publish", facet, value],
      ["clear", facet],
    ]);
  });
  test("clear leaves observation sets intact", () => {
    const calls: unknown[] = [];
    clearLasso({ filter: filterSpy(calls) });
    expect(calls).toEqual([["clear", "lasso"]]);
  });
});
