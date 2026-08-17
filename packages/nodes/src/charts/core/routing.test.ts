/// <reference types="bun" />
import { describe, expect, test } from "bun:test";

import { publishChartFilter } from "./routing";

describe("chart filter routing", () => {
  test("publishChartFilter publishes and clears the chart facet", () => {
    const calls: string[] = [];
    const host = {
      filter: {
        publish: (facet: string, sql: string) => calls.push(`publish:${facet}:${sql}`),
        clear: (facet: string) => calls.push(`clear:${facet}`),
      },
    };
    publishChartFilter(host, "col = 'A'");
    publishChartFilter(host, null);
    expect(calls).toEqual(["publish:chart:col = 'A'", "clear:chart"]);
  });
});
