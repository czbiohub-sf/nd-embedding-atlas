import { describe, expect, test } from "bun:test";
import { exactNodeTypeRef, nodeConfigVersion } from "@ndea/sdk";

import { createNodeAssetDraftFromSubgraph } from "./authoring";
import type { GraphDocumentEdge, GraphDocumentNode } from "../graph/records";

const nodes: Record<string, GraphDocumentNode> = {
  source: { id: "source", definitionRef: exactNodeTypeRef("source", "1.0.0"), label: "Source" },
  filter: {
    id: "filter",
    definitionRef: exactNodeTypeRef("filter", "1.0.0"),
    label: "Filter",
    config: { version: nodeConfigVersion(1), value: { threshold: 0.4 } },
  },
  sink: { id: "sink", definitionRef: exactNodeTypeRef("sink", "1.0.0"), label: "Sink" },
};
const edges: Record<string, GraphDocumentEdge> = {
  incoming: { id: "incoming", from: "source", fromPort: "out", to: "filter", toPort: "in", kind: "pred" },
  outgoing: { id: "outgoing", from: "filter", fromPort: "out", to: "sink", toPort: "in", kind: "pred" },
};

describe("node asset authoring", () => {
  test("infers boundary ports, exact dependencies, stable local ids, and explicit parameter bindings", () => {
    const draft = createNodeAssetDraftFromSubgraph({
      assetId: "org.example/filter",
      assetVersion: "1.0.0",
      title: "Filter",
      selectedNodeIds: ["filter"],
      nodes,
      edges,
      parameters: [
        { id: "threshold", label: "Threshold", nodeId: "filter", configPath: ["threshold"], defaultValue: 0.4 },
      ],
    });

    expect(draft.nodes.map((node) => node.id)).toEqual(["node-1"]);
    expect(draft.inputs).toEqual([{ id: "in", label: "In", kind: "pred", target: { nodeId: "node-1", portId: "in" } }]);
    expect(draft.outputs).toEqual([
      { id: "out", label: "Out", kind: "pred", source: { nodeId: "node-1", portId: "out" } },
    ]);
    expect(draft.parameters[0]?.target).toEqual({ nodeId: "node-1", configPath: ["threshold"] });
    expect(draft.dependencies).toEqual([{ kind: "node", definitionRef: exactNodeTypeRef("filter", "1.0.0") }]);
  });

  test("rejects empty and cross-level selections", () => {
    expect(() =>
      createNodeAssetDraftFromSubgraph({
        assetId: "org.example/x",
        assetVersion: "1.0.0",
        title: "X",
        selectedNodeIds: [],
        nodes,
        edges,
        parameters: [],
      }),
    ).toThrow(/selection/);
    expect(() =>
      createNodeAssetDraftFromSubgraph({
        assetId: "org.example/x",
        assetVersion: "1.0.0",
        title: "X",
        selectedNodeIds: ["filter", "sink"],
        nodes: { ...nodes, sink: { ...nodes.sink, parent: "subnet" } },
        edges,
        parameters: [],
      }),
    ).toThrow(/level/);
  });

  test("promotes terminal outputs for an isolated reusable selection", () => {
    const draft = createNodeAssetDraftFromSubgraph({
      assetId: "org.example/source",
      assetVersion: "1.0.0",
      title: "Source",
      selectedNodeIds: ["source"],
      nodes,
      edges: {},
      resolveDefinition: (ref) =>
        ref.nodeTypeId === "source" ? { outputs: [{ id: "out", label: "Out", kind: "pred" as const }] } : undefined,
      parameters: [],
    });
    expect(draft.outputs).toEqual([
      { id: "out", label: "Out", kind: "pred", source: { nodeId: "node-1", portId: "out" } },
    ]);
  });
});
