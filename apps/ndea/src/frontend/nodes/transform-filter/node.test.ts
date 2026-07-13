import { describe, expect, test } from "bun:test";

import type { GraphNodeCookHost } from "@/core/graph/cook";
import { thresholdNode } from "./node";

describe("threshold config-backed cook", () => {
  test("quotes the configured column and ANDs it with upstream", () => {
    const host = {
      id: "threshold-1",
      node: () => ({
        id: "threshold-1",
        type: "threshold",
        kind: "transform",
        label: "Threshold Filter",
        pluginId: "transform-filter",
        config: { column: 'score"raw', threshold: 0.25 },
      }),
      frozenPredicate: (): undefined => {},
    } as GraphNodeCookHost;

    expect(thresholdNode.graph.cook(new Map([["in", [{ kind: "pred", sql: "quality = 1" }]]]), host)).toEqual({
      kind: "pred",
      sql: '(quality = 1) AND ("score""raw" > 0.25)',
    });
  });

  test("passes upstream through when no column is configured", () => {
    const host = {
      id: "threshold-1",
      node: () => ({
        id: "threshold-1",
        type: "threshold",
        kind: "transform",
        label: "Threshold Filter",
        pluginId: "transform-filter",
        config: { column: null, threshold: 0 },
      }),
      frozenPredicate: (): undefined => {},
    } as GraphNodeCookHost;

    expect(thresholdNode.graph.cook(new Map([["in", [{ kind: "pred", sql: "score > 0.25" }]]]), host)).toEqual({
      kind: "pred",
      sql: "score > 0.25",
    });
  });
});
