/// <reference types="bun" />
import { describe, expect, test } from "bun:test";

import type { FilterClause } from "@ndea/protocol";
import { publishChartFilter } from "./routing";

describe("chart filter routing", () => {
  test("publishChartFilter publishes and clears the chart facet", () => {
    const calls: unknown[] = [];
    const host = {
      filter: {
        publish: (facet: string, clause: FilterClause) => {
          calls.push(["publish", facet, clause]);
        },
        clear: (facet: string) => {
          calls.push(["clear", facet]);
        },
      },
    };
    const clause: FilterClause = { op: "eq", column: "col", value: "A" };
    publishChartFilter(host, clause);
    publishChartFilter(host, null);
    expect(calls).toEqual([
      ["publish", "chart", clause],
      ["clear", "chart"],
    ]);
  });
});
