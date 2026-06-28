import { describe, expect, test } from "bun:test";

import { createSpyHost } from "@/core/node/spy-host";
import { publishChartFilter } from "./routing";

describe("chart selection-out routing", () => {
  test("publishChartFilter emits on the selection-out push port; null clears", () => {
    const { host, calls } = createSpyHost();
    publishChartFilter(host, "col = 'A'");
    publishChartFilter(host, null);
    // body-dock edge-binds the "lasso" facet to the node's sel out wire.
    expect(calls.publishPredicate).toEqual([
      { facet: "lasso", sql: "col = 'A'" },
      { facet: "lasso", sql: null },
    ]);
  });
});
