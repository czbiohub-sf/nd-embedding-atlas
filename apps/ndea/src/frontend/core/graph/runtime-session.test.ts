import { describe, expect, test } from "bun:test";
import { rowIndex } from "@ndea/sdk";

import type { GraphDocumentEdge, GraphDocumentNode } from "./records";
import { GraphRuntimeSession, type GraphRuntimeNodeSpec } from "./runtime-session";

const sourceSpec: GraphRuntimeNodeSpec = {
  type: "source",
  evaluationRole: "source",
  cook: () => ({ kind: "pred", sql: "quality > 0.5" }),
};

const transformSpec: GraphRuntimeNodeSpec = {
  type: "transform",
  evaluationRole: "transform",
  cook: (inputs) => inputs.get("in")?.[0] ?? { kind: "pred", sql: null },
};

function node(id: string, type: string): GraphDocumentNode {
  return { id, type, kind: type === "source" ? "source" : "transform", label: id, pluginId: null };
}

function edge(id: string, from: string, to: string): GraphDocumentEdge {
  return { id, from, to, toPort: "in", kind: "pred" };
}

function fixture(resolved: readonly GraphRuntimeNodeSpec[] = [sourceSpec, transformSpec]) {
  const nodes: Record<string, GraphDocumentNode> = {};
  const edges: Record<string, GraphDocumentEdge> = {};
  const byType = new Map(resolved.map((spec) => [spec.type, spec]));
  const runtime = new GraphRuntimeSession({
    resolver: { getSpec: (type) => byType.get(type) },
    document: { node: (id) => nodes[id], edges: () => Object.values(edges) },
    schedule: (flush) => flush(),
  });
  return { runtime, nodes, edges };
}

describe("GraphRuntimeSession", () => {
  test("owns registration, evaluator edges, sinks, dirtying, and per-node cleanup", () => {
    const { runtime, nodes, edges } = fixture();
    nodes.source = node("source", "source");
    nodes.sink = node("sink", "transform");
    expect(runtime.registerNode(nodes.source)).toBe(true);
    expect(runtime.registerNode(nodes.sink)).toBe(true);

    edges.e1 = edge("e1", "source", "sink");
    expect(runtime.connect(edges.e1)).toBe(true);
    expect(runtime.pull("sink")).toEqual({ kind: "pred", sql: "quality > 0.5" });

    const delivered: unknown[] = [];
    const unregister = runtime.registerSink("sink", (value) => delivered.push(value));
    runtime.markDirty("source");
    expect(delivered.at(-1)).toEqual({ kind: "pred", sql: "quality > 0.5" });
    unregister();

    runtime.removeNode("source");
    expect(runtime.isRegistered("source")).toBe(false);
    expect(runtime.pull("sink")).toEqual({ kind: "pred", sql: null });
    runtime.dispose();
  });

  test("keeps unresolved records and dependent edges inert without mutating document topology", () => {
    const { runtime, nodes, edges } = fixture();
    nodes.source = node("source", "source");
    nodes.missing = node("missing", "external-missing");
    nodes.sink = node("sink", "transform");
    edges.e1 = edge("e1", "source", "missing");
    edges.e2 = edge("e2", "missing", "sink");

    runtime.load({ nodes, edges, flags: {} });

    expect(runtime.isRegistered("source")).toBe(true);
    expect(runtime.isRegistered("missing")).toBe(false);
    expect(runtime.isRegistered("sink")).toBe(true);
    expect(runtime.unresolvedNodes(nodes).map(({ id }) => id)).toEqual(["missing"]);
    expect(runtime.pull("sink")).toEqual({ kind: "pred", sql: null });
    expect(Object.keys(nodes)).toEqual(["source", "missing", "sink"]);
    expect(Object.keys(edges)).toEqual(["e1", "e2"]);
    runtime.dispose();

    const restored = fixture([sourceSpec, transformSpec, { ...transformSpec, type: "external-missing" }]);
    Object.assign(restored.nodes, nodes);
    Object.assign(restored.edges, edges);
    restored.runtime.load({ nodes: restored.nodes, edges: restored.edges, flags: {} });
    expect(restored.runtime.isRegistered("missing")).toBe(true);
    expect(restored.runtime.unresolvedNodes(restored.nodes)).toEqual([]);
    expect(restored.runtime.pull("sink")).toEqual({ kind: "pred", sql: "quality > 0.5" });
    restored.runtime.dispose();
  });

  test("rolls back evaluator registration when a known loaded topology is invalid", () => {
    const { runtime, nodes, edges } = fixture();
    nodes.a = node("a", "transform");
    nodes.b = node("b", "transform");
    edges.e1 = edge("e1", "a", "b");
    edges.e2 = edge("e2", "b", "a");

    expect(() => runtime.load({ nodes, edges, flags: {} })).toThrow('graph runtime rejected edge "e2"');
    expect(runtime.isRegistered("a")).toBe(false);
    expect(runtime.isRegistered("b")).toBe(false);
    expect(Object.keys(edges)).toEqual(["e1", "e2"]);
    runtime.dispose();
  });

  test("owns authored row sets and frozen checkpoint state by value", () => {
    const { runtime, nodes, edges } = fixture();
    nodes.source = node("source", "source");
    nodes.cache = node("cache", "transform");
    runtime.registerNode(nodes.source);
    runtime.registerNode(nodes.cache);
    edges.selection = { ...edge("selection", "source", "cache"), kind: "sel" };
    expect(runtime.connect(edges.selection)).toBe(true);

    const rows = [rowIndex(3), rowIndex(8)];
    runtime.emitSelection("source", "selection_temp", rows);
    expect(runtime.pinCheckpoint("cache")).not.toBeNull();
    rows[0] = rowIndex(99);

    expect(runtime.isCheckpointPinned("cache")).toBe(true);
    expect(runtime.checkpointRows("cache")).toEqual([rowIndex(3), rowIndex(8)]);
    runtime.unpinCheckpoint("cache");
    expect(runtime.checkpointRows("cache")).toBeUndefined();
    runtime.dispose();
  });
});
