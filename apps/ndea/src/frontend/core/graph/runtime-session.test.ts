import { describe, expect, test } from "bun:test";
import { exactNodeTypeRef, rowIndex } from "@ndea/sdk";

import { assetInnerNodeId, assetOutputBoundaryNodeId, compileNodeAsset } from "@/core/node-asset/compiler";
import { parseNodeAssetDefinition } from "@/core/node-asset/schema";
import type { GraphDocumentEdge, GraphDocumentNode } from "./records";
import { GraphRuntimeSession, validateGraphRuntimeTopology, type GraphRuntimeNodeSpec } from "./runtime-session";

const sourceSpec: GraphRuntimeNodeSpec = {
  definition: {
    ref: exactNodeTypeRef("source", "1.0.0"),
    inputs: [],
    outputs: [{ id: "out", kind: "pred" }],
  },
  evaluationRole: "source",
  cook: () => ({ kind: "pred", sql: "quality > 0.5" }),
};

const transformSpec: GraphRuntimeNodeSpec = {
  definition: {
    ref: exactNodeTypeRef("transform", "1.0.0"),
    inputs: [{ id: "in", kind: "pred" }],
    outputs: [{ id: "out", kind: "pred" }],
  },
  evaluationRole: "transform",
  cook: (inputs) => inputs.get("in")?.[0] ?? { kind: "pred", sql: null },
};

function node(id: string, type: string): GraphDocumentNode {
  return { id, definitionRef: exactNodeTypeRef(type, "1.0.0"), label: id };
}

function edge(id: string, from: string, to: string): GraphDocumentEdge {
  return { id, from, fromPort: "out", to, toPort: "in", kind: "pred" };
}

function fixture(resolved: readonly GraphRuntimeNodeSpec[] = [sourceSpec, transformSpec]) {
  const nodes: Record<string, GraphDocumentNode> = {};
  const edges: Record<string, GraphDocumentEdge> = {};
  const byRef = new Map(
    resolved.map((spec) => [`${spec.definition.ref.nodeTypeId}@${spec.definition.ref.nodeTypeVersion}`, spec]),
  );
  const resolver = {
    getSpecExact: (ref: GraphDocumentNode["definitionRef"]) => byRef.get(`${ref.nodeTypeId}@${ref.nodeTypeVersion}`),
  };
  const runtime = new GraphRuntimeSession({
    resolver,
    document: { node: (id) => nodes[id], edges: () => Object.values(edges) },
    schedule: (flush) => flush(),
  });
  return { runtime, resolver, nodes, edges };
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

    const restored = fixture([
      sourceSpec,
      transformSpec,
      {
        ...transformSpec,
        definition: {
          ...transformSpec.definition,
          ref: exactNodeTypeRef("external-missing", "1.0.0"),
        },
      },
    ]);
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

  test("pure topology validation rejects malformed resolved wires and preserves unresolved incident wires", () => {
    const { runtime, resolver, nodes, edges } = fixture();
    nodes.source = node("source", "source");
    nodes.sink = node("sink", "transform");
    nodes.missing = node("missing", "external-missing");

    edges.missingEndpoint = edge("missingEndpoint", "source", "ghost");
    expect(() => validateGraphRuntimeTopology({ nodes, edges, flags: {} }, resolver)).toThrow(
      'edge "missingEndpoint" references missing node "ghost"',
    );

    delete edges.missingEndpoint;
    edges.badPort = { ...edge("badPort", "source", "sink"), toPort: "missing-port" };
    expect(() => validateGraphRuntimeTopology({ nodes, edges, flags: {} }, resolver)).toThrow(
      'edge "badPort" targets undeclared input port "missing-port"',
    );

    delete edges.badPort;
    edges.badKind = { ...edge("badKind", "source", "sink"), kind: "sel" };
    expect(() => validateGraphRuntimeTopology({ nodes, edges, flags: {} }, resolver)).toThrow(
      'edge "badKind" kind "sel"',
    );

    delete edges.badKind;
    edges.unresolved = {
      id: "unresolved",
      from: "missing",
      fromPort: "future-output",
      to: "missing",
      toPort: "future-port",
      kind: "focus",
    };
    expect(() => validateGraphRuntimeTopology({ nodes, edges, flags: {} }, resolver)).not.toThrow();
    expect(edges.unresolved).toEqual({
      id: "unresolved",
      from: "missing",
      fromPort: "future-output",
      to: "missing",
      toPort: "future-port",
      kind: "focus",
    });
    runtime.dispose();
  });

  test("enforces same-parent scope only for resolved edges before evaluator registration", () => {
    const { runtime, nodes, edges } = fixture();
    nodes.source = node("source", "source");
    nodes.sink = { ...node("sink", "transform"), parent: "subnet" };
    edges.crossParent = edge("cross-parent", "source", "sink");

    expect(() => runtime.load({ nodes, edges, flags: {} })).toThrow(
      'edge "cross-parent" crosses parent scope "<root>" -> "subnet"',
    );
    expect(runtime.isRegistered("source")).toBe(false);
    expect(runtime.isRegistered("sink")).toBe(false);

    nodes.source.parent = "subnet";
    expect(() => runtime.load({ nodes, edges, flags: {} })).not.toThrow();
    expect(runtime.pull("sink")).toEqual({ kind: "pred", sql: "quality > 0.5" });
    runtime.dispose();

    const unresolved = fixture();
    unresolved.nodes.source = node("source", "source");
    unresolved.nodes.missing = { ...node("missing", "external-missing"), parent: "subnet" };
    unresolved.edges.opaque = edge("opaque", "source", "missing");

    expect(() =>
      unresolved.runtime.load({ nodes: unresolved.nodes, edges: unresolved.edges, flags: {} }),
    ).not.toThrow();
    expect(unresolved.runtime.isRegistered("source")).toBe(true);
    expect(unresolved.runtime.isRegistered("missing")).toBe(false);
    expect(unresolved.edges.opaque).toEqual(edge("opaque", "source", "missing"));
    unresolved.runtime.dispose();
  });

  test("rejects duplicate resolved wires before loading evaluator state", () => {
    const { runtime, nodes, edges } = fixture();
    nodes.source = node("source", "source");
    nodes.sink = node("sink", "transform");
    edges.first = edge("first", "source", "sink");
    edges.second = edge("second", "source", "sink");

    expect(() => runtime.load({ nodes, edges, flags: {} })).toThrow(
      'graph topology duplicates resolved wire "source:out" -> "sink:in"',
    );
    expect(runtime.isRegistered("source")).toBe(false);
    expect(runtime.isRegistered("sink")).toBe(false);
    runtime.dispose();
  });

  test("includes resolved subnet seams when checking cycles", () => {
    const subnetSpec: GraphRuntimeNodeSpec = {
      ...transformSpec,
      definition: {
        ...transformSpec.definition,
        ref: exactNodeTypeRef("subnet", "1.0.0"),
      },
    };
    const proxySpec: GraphRuntimeNodeSpec = {
      ...transformSpec,
      definition: {
        ...transformSpec.definition,
        ref: exactNodeTypeRef("proxy", "1.0.0"),
      },
    };
    const { runtime, nodes, edges } = fixture([subnetSpec, proxySpec]);
    nodes.subnet = node("subnet", "subnet");
    nodes["subnet-out"] = node("subnet-out", "proxy");
    edges.loop = edge("loop", "subnet", "subnet-out");

    expect(() => runtime.load({ nodes, edges, flags: {} })).toThrow('graph runtime rejected edge "loop"');
    expect(runtime.isRegistered("subnet")).toBe(false);
    expect(runtime.isRegistered("subnet-out")).toBe(false);
    runtime.dispose();
  });

  test("removes expansion nodes and their dependent runtime state deterministically", () => {
    const definition = parseNodeAssetDefinition({
      schemaVersion: 1,
      assetId: "org.example/teardown",
      assetVersion: "1.0.0",
      nodeTypeRef: exactNodeTypeRef("asset/org.example/teardown", "1.0.0"),
      title: "Teardown",
      dependencies: [{ kind: "node", definitionRef: transformSpec.definition.ref }],
      nodes: [
        { id: "first", definitionRef: transformSpec.definition.ref },
        { id: "second", definitionRef: transformSpec.definition.ref },
      ],
      edges: [
        {
          id: "chain",
          from: "first",
          fromPort: "out",
          to: "second",
          toPort: "in",
          kind: "pred",
        },
      ],
      inputs: [],
      outputs: [{ id: "out", label: "Out", kind: "pred", source: { nodeId: "second", portId: "out" } }],
      parameters: [],
      documentation: { summary: "Teardown" },
      presentation: {},
      visibility: "public",
    });
    const compiled = compileNodeAsset(
      definition,
      {
        getSpecExact: (ref) => (ref.nodeTypeId === transformSpec.definition.ref.nodeTypeId ? transformSpec : undefined),
      },
      { sourceId: "test", kind: "user" },
    );
    const nodes = {
      asset: { id: "asset", definitionRef: compiled.spec.definition.ref, label: "Asset" },
    };
    const runtime = new GraphRuntimeSession({
      resolver: {
        getSpecExact: (ref) =>
          ref.nodeTypeId === compiled.spec.definition.ref.nodeTypeId ? compiled.spec : transformSpec,
        getAssetExpansionExact: (ref) =>
          ref.nodeTypeId === compiled.spec.definition.ref.nodeTypeId ? compiled.expansion : undefined,
      },
      document: { node: (id) => nodes[id as keyof typeof nodes], edges: () => [] },
      schedule: (flush) => flush(),
    });
    runtime.load({ nodes, edges: {}, flags: {} });
    const expandedIds = [
      assetInnerNodeId("asset", "first"),
      assetInnerNodeId("asset", "second"),
      assetOutputBoundaryNodeId("asset", "out"),
    ];
    for (const id of expandedIds) {
      expect(runtime.isRegistered(id)).toBe(true);
      runtime.setCheckpointStatus(id, { pending: true, error: null });
    }

    runtime.removeNode("asset");

    expect(runtime.isRegistered("asset")).toBe(false);
    expect(expandedIds.map((id) => runtime.isRegistered(id))).toEqual([false, false, false]);
    expect(runtime.checkpoints.state).toEqual({});
    expect(() => runtime.removeNode("asset")).not.toThrow();
    runtime.dispose();
  });

  test("rejects configuration patches for definitions without a config contract", () => {
    const { runtime, nodes } = fixture();
    const original = node("source", "source");
    nodes.source = original;
    runtime.registerNode(original);

    expect(() => runtime.patchNodeConfig(original, { fabricated: true })).toThrow(
      'node "source" does not accept configuration',
    );
    expect(nodes.source).toBe(original);
    expect(nodes.source.config).toBeUndefined();
    runtime.dispose();
  });

  test("owns frozen checkpoint rows by value and preserves active-empty", () => {
    const cacheSpec: GraphRuntimeNodeSpec = {
      ...transformSpec,
      definition: {
        ...transformSpec.definition,
        ref: exactNodeTypeRef("cache", "1.0.0"),
      },
      cook: (inputs, host) => {
        const frozen = host.frozenPredicate();
        return frozen === undefined
          ? (inputs.get("in")?.[0] ?? { kind: "pred", sql: null })
          : { kind: "pred", sql: frozen };
      },
    };
    const { runtime, nodes } = fixture([sourceSpec, transformSpec, cacheSpec]);
    nodes.cache = node("cache", "cache");
    runtime.registerNode(nodes.cache);

    const rows = [rowIndex(3), rowIndex(8)];
    runtime.pinCheckpointRows("cache", rows);
    rows[0] = rowIndex(99);

    expect(runtime.isCheckpointPinned("cache")).toBe(true);
    expect(runtime.checkpointRows("cache")).toEqual([rowIndex(3), rowIndex(8)]);
    runtime.unpinCheckpoint("cache");
    expect(runtime.checkpointRows("cache")).toBeUndefined();
    runtime.pinCheckpointRows("cache", []);
    expect(runtime.pull("cache")).toEqual({ kind: "pred", sql: "FALSE" });
    runtime.dispose();
  });

  test("owns transient checkpoint status and clears it with node/session disposal", () => {
    const { runtime, nodes } = fixture();
    nodes.source = node("source", "source");
    nodes.cache = node("cache", "transform");
    runtime.registerNode(nodes.source);
    runtime.registerNode(nodes.cache);
    runtime.setCheckpointStatus("cache", { pending: true, error: null });
    expect(runtime.checkpoints.state.cache).toEqual({ pending: true, error: null });

    runtime.removeNode("cache");
    expect(runtime.checkpoints.state.cache).toBeUndefined();
    runtime.setCheckpointStatus("other", { pending: false, error: "failed" });
    runtime.dispose();
    expect(runtime.checkpoints.state).toEqual({});
  });
});
