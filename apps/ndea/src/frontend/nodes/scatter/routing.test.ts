import { describe, expect, test } from "vite-plus/test";
import { Selection } from "@uwdata/mosaic-core";
import type { FilterCoordinationAPI, NodeDataAPI } from "@ndea/sdk";
import { rowIndex } from "@ndea/sdk";
import { clearLasso, publishIsolationFilter, publishLasso, publishRangeFilter, stageLassoRowSet } from "./routing";

function filterSpy(calls: unknown[]): FilterCoordinationAPI {
  return {
    selection: Selection.crossfilter(),
    getResolved: () => ({ predicate: null, revision: 0 }),
    subscribeResolved: () => () => {},
    publish: (facet, predicate, rowIds) => calls.push(["publish", facet, predicate, rowIds]),
    clear: (facet) => calls.push(["clear", facet]),
    associateClient: () => {},
    disassociateClient: () => {},
    materializeRowIds: async () => ({ rowIds: [], revision: 0 }),
  };
}

describe("Scatter filter routing", () => {
  test("publishes independent facets and clears only the requested facet", () => {
    const calls: unknown[] = [];
    const host = { filter: filterSpy(calls) } satisfies Parameters<typeof publishLasso>[0];
    const selectedRows = [rowIndex(2), rowIndex(5)];

    publishLasso(host, "__row_index__ IN (2, 5)", selectedRows);
    publishRangeFilter(host, '"score" >= 3');
    publishIsolationFilter(host, "\"class\" IN ('A')");
    publishRangeFilter(host, null);

    expect(calls).toEqual([
      ["publish", "lasso", "__row_index__ IN (2, 5)", selectedRows],
      ["publish", "range", '"score" >= 3', undefined],
      ["publish", "isolation", "\"class\" IN ('A')", undefined],
      ["clear", "range"],
    ]);
  });

  test("stages large rows only through dataAPI and disposes the resource on clear", async () => {
    const calls: unknown[] = [];
    const dataAPI = {
      query: async () => {
        throw new Error("query is not used by the row-set staging contract");
      },
      publishRowSet: async (rows) => {
        calls.push(["stage", rows]);
        return {
          predicate: "__row_index__ IN (SELECT row_index FROM sel_scatter) /* tok=7 */",
          token: 7,
          count: rows.length,
          table: "sel_scatter",
        };
      },
      disposePublishedRowSet: async () => {
        calls.push(["dispose"]);
      },
    } satisfies NodeDataAPI<"row-set-publish">;
    const stagingHost = { dataAPI } satisfies Parameters<typeof stageLassoRowSet>[0];
    const clearHost = {
      filter: filterSpy(calls),
      dataAPI,
    } satisfies Parameters<typeof clearLasso>[0];

    await expect(stageLassoRowSet(stagingHost, [rowIndex(3), rowIndex(8)])).resolves.toContain("/* tok=7 */");
    await clearLasso(clearHost);

    expect(calls).toEqual([["stage", [rowIndex(3), rowIndex(8)]], ["clear", "lasso"], ["dispose"]]);
  });
});
