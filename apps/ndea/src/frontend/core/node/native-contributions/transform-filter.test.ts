import { describe, expect, test } from "bun:test";
import { exactNodeTypeRef, nodeConfigVersion } from "@ndea/sdk";

import { patchNodeConfig, type GraphNodeCookHost } from "@/core/graph/cook";
import type { GraphDocumentNode } from "@/core/graph/records";
import { thresholdNode } from "./transform-filter";

describe("threshold config-backed cook", () => {
  test("quotes the configured column and ANDs it with upstream", () => {
    const host = {
      id: "threshold-1",
      node: () => ({
        id: "threshold-1",
        definitionRef: exactNodeTypeRef("transform-filter", "1.0.0"),
        label: "Threshold Filter",
        config: { version: nodeConfigVersion(1), value: { column: 'score"raw', threshold: 0.25 } },
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
        definitionRef: exactNodeTypeRef("transform-filter", "1.0.0"),
        label: "Threshold Filter",
        config: { version: nodeConfigVersion(1), value: { column: null, threshold: 0 } },
      }),
      frozenPredicate: (): undefined => {},
    } as GraphNodeCookHost;

    expect(thresholdNode.graph.cook(new Map([["in", [{ kind: "pred", sql: "score > 0.25" }]]]), host)).toEqual({
      kind: "pred",
      sql: "score > 0.25",
    });
  });

  test("edited numeric config retains its exact version and semantics through a JSON round-trip", () => {
    const original: GraphDocumentNode = {
      id: "threshold-1",
      definitionRef: exactNodeTypeRef("transform-filter", "1.0.0"),
      label: "Threshold Filter",
      config: { version: nodeConfigVersion(1), value: { column: "score", threshold: 0 } },
    };
    const edited: GraphDocumentNode = {
      ...original,
      config: {
        version: original.config!.version,
        value: patchNodeConfig(original, { threshold: 2 }),
      },
    };
    const restored = JSON.parse(JSON.stringify(edited)) as GraphDocumentNode;
    const host = {
      id: restored.id,
      node: () => restored,
      frozenPredicate: (): undefined => {},
    } as GraphNodeCookHost;
    expect(restored.config).toEqual({ version: nodeConfigVersion(1), value: { column: "score", threshold: 2 } });
    expect(thresholdNode.graph.cook(new Map(), host)).toEqual({ kind: "pred", sql: '"score" > 2' });
  });
});
