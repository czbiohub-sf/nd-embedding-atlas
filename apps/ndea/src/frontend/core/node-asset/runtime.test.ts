import { describe, expect, test } from "bun:test";
import { exactNodeTypeRef, nodeConfigVersion } from "@ndea/sdk";
import { z } from "zod";

import { nodeConfig, predicateSqls } from "../graph/cook";
import type { GraphDocumentEdge, GraphDocumentNode } from "../graph/records";
import { GraphRuntimeSession, type GraphRuntimeNodeSpec } from "../graph/runtime-session";
import { andPreds } from "@ndea/graph";
import { compileNodeAsset } from "./compiler";
import { parseNodeAssetDefinition } from "./schema";

const sourceSpec: GraphRuntimeNodeSpec = {
  definition: { ref: exactNodeTypeRef("source", "1.0.0"), inputs: [], outputs: [{ id: "out", kind: "pred" }] },
  evaluationRole: "source",
  cook: () => ({ kind: "pred", sql: "quality > 0.5" }),
};
const filterSpec: GraphRuntimeNodeSpec = {
  definition: {
    ref: exactNodeTypeRef("filter", "1.0.0"),
    inputs: [{ id: "in", kind: "pred" }],
    outputs: [{ id: "out", kind: "pred" }],
    config: {
      version: 1,
      defaultValue: { threshold: 0.2 },
      schema: z.object({ threshold: z.number().min(0).max(1) }).strict(),
    },
  },
  evaluationRole: "transform",
  cook: (inputs, host) => {
    const config = nodeConfig<{ threshold: number }>(host.node());
    return { kind: "pred", sql: andPreds([...predicateSqls(inputs), `score > ${config.threshold}`]) };
  },
};
const sinkSpec: GraphRuntimeNodeSpec = {
  definition: {
    ref: exactNodeTypeRef("sink", "1.0.0"),
    inputs: [{ id: "in", kind: "pred" }],
    outputs: [{ id: "out", kind: "pred" }],
  },
  evaluationRole: "view",
  cook: (inputs) => inputs.get("in")?.[0] ?? { kind: "pred", sql: null },
};

function assetDefinition() {
  return parseNodeAssetDefinition({
    schemaVersion: 1,
    assetId: "org.example/threshold",
    assetVersion: "1.0.0",
    nodeTypeRef: exactNodeTypeRef("asset/org.example/threshold", "1.0.0"),
    title: "Threshold",
    dependencies: [{ kind: "node", definitionRef: filterSpec.definition.ref }],
    nodes: [
      {
        id: "filter",
        definitionRef: filterSpec.definition.ref,
        config: { version: nodeConfigVersion(1), value: { threshold: 0.2 } },
      },
    ],
    edges: [],
    inputs: [{ id: "in", label: "In", kind: "pred", target: { nodeId: "filter", portId: "in" } }],
    outputs: [{ id: "out", label: "Out", kind: "pred", source: { nodeId: "filter", portId: "out" } }],
    parameters: [
      {
        id: "threshold",
        label: "Threshold",
        defaultValue: 0.2,
        target: { nodeId: "filter", configPath: ["threshold"] },
      },
    ],
    documentation: { summary: "Threshold" },
    presentation: {},
    visibility: "public",
  });
}

function edge(id: string, from: string, fromPort: string, to: string, toPort: string): GraphDocumentEdge {
  return { id, from, fromPort, to, toPort, kind: "pred" };
}

describe("node asset graph runtime", () => {
  test("executes promoted input/output/parameter predicates and removes expansion idempotently", () => {
    const base = new Map([
      ["source@1.0.0", sourceSpec],
      ["filter@1.0.0", filterSpec],
      ["sink@1.0.0", sinkSpec],
    ]);
    const compiled = compileNodeAsset(
      assetDefinition(),
      { getSpecExact: (ref) => base.get(`${ref.nodeTypeId}@${ref.nodeTypeVersion}`) },
      { sourceId: "user", kind: "user" },
    );
    const resolver = {
      getSpecExact: (ref: { nodeTypeId: string; nodeTypeVersion: string }) =>
        compiled.spec.definition.ref.nodeTypeId === ref.nodeTypeId &&
        compiled.spec.definition.ref.nodeTypeVersion === ref.nodeTypeVersion
          ? compiled.spec
          : base.get(`${ref.nodeTypeId}@${ref.nodeTypeVersion}`),
      getAssetExpansionExact: (ref: { nodeTypeId: string; nodeTypeVersion: string }) =>
        ref.nodeTypeId === compiled.spec.definition.ref.nodeTypeId &&
        ref.nodeTypeVersion === compiled.spec.definition.ref.nodeTypeVersion
          ? compiled.expansion
          : undefined,
    };
    const nodes: Record<string, GraphDocumentNode> = {
      source: { id: "source", definitionRef: sourceSpec.definition.ref, label: "Source" },
      threshold: {
        id: "threshold",
        definitionRef: compiled.spec.definition.ref,
        label: "Threshold",
        config: { version: nodeConfigVersion(1), value: { threshold: 0.8 } },
      },
      sink: { id: "sink", definitionRef: sinkSpec.definition.ref, label: "Sink" },
    };
    const edges = {
      e1: edge("e1", "source", "out", "threshold", "in"),
      e2: edge("e2", "threshold", "out", "sink", "in"),
    };
    const runtime = new GraphRuntimeSession({
      resolver,
      document: { node: (id) => nodes[id], edges: () => Object.values(edges) },
      schedule: (flush) => flush(),
    });

    runtime.load({ nodes, edges, flags: {} });
    expect(runtime.pull("sink")).toEqual({ kind: "pred", sql: "(quality > 0.5) AND (score > 0.8)" });
    expect(runtime.isRegistered("threshold::asset::filter")).toBe(true);
    runtime.removeNode("threshold");
    expect(runtime.isRegistered("threshold::asset::filter")).toBe(false);
    runtime.removeNode("threshold");
    runtime.dispose();
  });

  test("leaves no partial graph mutation when topology validation fails", () => {
    const nodes = {
      source: { id: "source", definitionRef: sourceSpec.definition.ref, label: "Source" },
      sink: { id: "sink", definitionRef: sinkSpec.definition.ref, label: "Sink" },
    };
    const edges = { bad: edge("bad", "source", "missing", "sink", "in") };
    const resolver = {
      getSpecExact: (ref: { nodeTypeId: string; nodeTypeVersion: string }) =>
        ref.nodeTypeId === "source" ? sourceSpec : ref.nodeTypeId === "sink" ? sinkSpec : undefined,
    };
    const runtime = new GraphRuntimeSession({
      resolver,
      document: { node: (id) => nodes[id as keyof typeof nodes], edges: () => Object.values(edges) },
    });
    expect(() => runtime.load({ nodes, edges, flags: {} })).toThrow(/output port/);
    expect(runtime.isRegistered("source")).toBe(false);
    expect(runtime.isRegistered("sink")).toBe(false);
    runtime.dispose();
  });

  test("uses promoted port ids for connection checks and checkpoint inputs", () => {
    const renamedDefinition = parseNodeAssetDefinition({
      ...assetDefinition(),
      inputs: [{ id: "predicate", label: "Predicate", kind: "pred", target: { nodeId: "filter", portId: "in" } }],
      outputs: [{ id: "filtered", label: "Filtered", kind: "pred", source: { nodeId: "filter", portId: "out" } }],
    });
    const base = new Map([
      ["source@1.0.0", sourceSpec],
      ["filter@1.0.0", filterSpec],
      ["sink@1.0.0", sinkSpec],
    ]);
    const renamed = compileNodeAsset(
      renamedDefinition,
      { getSpecExact: (ref) => base.get(`${ref.nodeTypeId}@${ref.nodeTypeVersion}`) },
      { sourceId: "user", kind: "user" },
    );
    const renamedResolver = {
      getSpecExact: (ref: { nodeTypeId: string; nodeTypeVersion: string }) =>
        ref.nodeTypeId === renamed.spec.definition.ref.nodeTypeId
          ? renamed.spec
          : base.get(`${ref.nodeTypeId}@${ref.nodeTypeVersion}`),
      getAssetExpansionExact: (ref: { nodeTypeId: string }) =>
        ref.nodeTypeId === renamed.spec.definition.ref.nodeTypeId ? renamed.expansion : undefined,
    };
    const renamedNodes: Record<string, GraphDocumentNode> = {
      source: { id: "source", definitionRef: sourceSpec.definition.ref, label: "Source" },
      asset: { id: "asset", definitionRef: renamed.spec.definition.ref, label: "Asset" },
      sink: { id: "sink", definitionRef: sinkSpec.definition.ref, label: "Sink" },
    };
    const connectionRuntime = new GraphRuntimeSession({
      resolver: renamedResolver,
      document: { node: (id) => renamedNodes[id], edges: () => [] },
      schedule: (flush) => flush(),
    });
    expect(connectionRuntime.registerNode(renamedNodes.source)).toBe(true);
    expect(connectionRuntime.registerNode(renamedNodes.asset)).toBe(true);
    expect(connectionRuntime.registerNode(renamedNodes.sink)).toBe(true);
    expect(connectionRuntime.canConnect("source", "asset", undefined, "out", "predicate")).toBe(true);
    expect(connectionRuntime.canConnect("asset", "sink", undefined, "filtered", "in")).toBe(true);
    connectionRuntime.dispose();

    const firstRef = exactNodeTypeRef("first-source", "1.0.0");
    const secondRef = exactNodeTypeRef("second-source", "1.0.0");
    const firstSpec: GraphRuntimeNodeSpec = {
      definition: { ref: firstRef, inputs: [], outputs: [{ id: "out", kind: "pred" }] },
      evaluationRole: "source",
      cook: () => ({ kind: "pred", sql: "first = true" }),
    };
    const secondSpec: GraphRuntimeNodeSpec = {
      definition: { ref: secondRef, inputs: [], outputs: [{ id: "out", kind: "pred" }] },
      evaluationRole: "source",
      cook: () => ({ kind: "pred", sql: "second = true" }),
    };
    const multiDefinition = parseNodeAssetDefinition({
      schemaVersion: 1,
      assetId: "org.example/multi-output",
      assetVersion: "1.0.0",
      nodeTypeRef: exactNodeTypeRef("asset/org.example/multi-output", "1.0.0"),
      title: "Multi-output",
      dependencies: [
        { kind: "node", definitionRef: firstRef },
        { kind: "node", definitionRef: secondRef },
      ],
      nodes: [
        { id: "first", definitionRef: firstRef },
        { id: "second", definitionRef: secondRef },
      ],
      edges: [],
      inputs: [],
      outputs: [
        { id: "first", label: "First", kind: "pred", source: { nodeId: "first", portId: "out" } },
        { id: "second", label: "Second", kind: "pred", source: { nodeId: "second", portId: "out" } },
      ],
      parameters: [],
      documentation: { summary: "Multi-output" },
      presentation: {},
      visibility: "public",
    });
    const multiBase = new Map<string, GraphRuntimeNodeSpec>([
      [`${firstRef.nodeTypeId}@${firstRef.nodeTypeVersion}`, firstSpec],
      [`${secondRef.nodeTypeId}@${secondRef.nodeTypeVersion}`, secondSpec],
      ["sink@1.0.0", sinkSpec],
    ]);
    const multi = compileNodeAsset(
      multiDefinition,
      { getSpecExact: (ref) => multiBase.get(`${ref.nodeTypeId}@${ref.nodeTypeVersion}`) },
      { sourceId: "user", kind: "user" },
    );
    const multiResolver = {
      getSpecExact: (ref: { nodeTypeId: string; nodeTypeVersion: string }) =>
        ref.nodeTypeId === multi.spec.definition.ref.nodeTypeId
          ? multi.spec
          : multiBase.get(`${ref.nodeTypeId}@${ref.nodeTypeVersion}`),
      getAssetExpansionExact: (ref: { nodeTypeId: string }) =>
        ref.nodeTypeId === multi.spec.definition.ref.nodeTypeId ? multi.expansion : undefined,
    };
    const multiNodes: Record<string, GraphDocumentNode> = {
      multi: { id: "multi", definitionRef: multi.spec.definition.ref, label: "Multi" },
      checkpoint: { id: "checkpoint", definitionRef: sinkSpec.definition.ref, label: "Checkpoint" },
    };
    const multiEdges = {
      second: edge("second", "multi", "second", "checkpoint", "in"),
    };
    const checkpointRuntime = new GraphRuntimeSession({
      resolver: multiResolver,
      document: { node: (id) => multiNodes[id], edges: () => Object.values(multiEdges) },
      schedule: (flush) => flush(),
    });
    checkpointRuntime.load({ nodes: multiNodes, edges: multiEdges, flags: {} });
    expect(checkpointRuntime.liveCheckpointInput("checkpoint")).toEqual({ kind: "pred", sql: "second = true" });
    checkpointRuntime.dispose();
  });

  test("deactivates missing asset expansions and restores the same outer instance", () => {
    const base = new Map([
      ["source@1.0.0", sourceSpec],
      ["filter@1.0.0", filterSpec],
      ["sink@1.0.0", sinkSpec],
    ]);
    const compiled = compileNodeAsset(
      assetDefinition(),
      { getSpecExact: (ref) => base.get(`${ref.nodeTypeId}@${ref.nodeTypeVersion}`) },
      { sourceId: "user", kind: "user" },
    );
    let available = true;
    const resolver = {
      getSpecExact: (ref: { nodeTypeId: string; nodeTypeVersion: string }) =>
        ref.nodeTypeId === compiled.spec.definition.ref.nodeTypeId
          ? available
            ? compiled.spec
            : undefined
          : base.get(`${ref.nodeTypeId}@${ref.nodeTypeVersion}`),
      getAssetExpansionExact: (ref: { nodeTypeId: string }) =>
        available && ref.nodeTypeId === compiled.spec.definition.ref.nodeTypeId ? compiled.expansion : undefined,
    };
    const nodes: Record<string, GraphDocumentNode> = {
      source: { id: "source", definitionRef: sourceSpec.definition.ref, label: "Source" },
      asset: { id: "asset", definitionRef: compiled.spec.definition.ref, label: "Asset" },
      sink: { id: "sink", definitionRef: sinkSpec.definition.ref, label: "Sink" },
    };
    const edges = {
      input: edge("input", "source", "out", "asset", "in"),
      output: edge("output", "asset", "out", "sink", "in"),
    };
    const runtime = new GraphRuntimeSession({
      resolver,
      document: { node: (id) => nodes[id], edges: () => Object.values(edges) },
      schedule: (flush) => flush(),
    });
    const topology = { nodes, edges, flags: {} };
    runtime.load(topology);
    expect(runtime.isRegistered("asset::asset::filter")).toBe(true);
    const sinkValues: string[] = [];
    const unregister = runtime.registerSink("asset", (value) => {
      if (value.kind === "pred" && value.sql) sinkValues.push(value.sql);
    });
    expect(sinkValues).toHaveLength(1);
    runtime.refreshResolutions(topology);
    expect(sinkValues.at(-1)).toBe("(quality > 0.5) AND (score > 0.2)");
    const valuesAfterRefresh = sinkValues.length;
    runtime.markDirty("source");
    expect(sinkValues.length).toBeGreaterThan(valuesAfterRefresh);

    available = false;
    runtime.refreshResolutions(topology);
    expect(runtime.isRegistered("asset")).toBe(false);
    expect(runtime.isRegistered("asset::asset::filter")).toBe(false);

    available = true;
    runtime.refreshResolutions(topology);
    expect(runtime.isRegistered("asset")).toBe(true);
    expect(runtime.isRegistered("asset::asset::filter")).toBe(true);
    expect(runtime.pull("sink")).toEqual({ kind: "pred", sql: "(quality > 0.5) AND (score > 0.2)" });
    expect(sinkValues.at(-1)).toBe("(quality > 0.5) AND (score > 0.2)");
    unregister();
    runtime.dispose();
  });

  test("recooks asset config while preserving inert edges to unresolved definitions", () => {
    const base = new Map([["filter@1.0.0", filterSpec]]);
    const compiled = compileNodeAsset(
      assetDefinition(),
      { getSpecExact: (ref) => base.get(`${ref.nodeTypeId}@${ref.nodeTypeVersion}`) },
      { sourceId: "user", kind: "user" },
    );
    const resolver = {
      getSpecExact: (ref: { nodeTypeId: string; nodeTypeVersion: string }) =>
        ref.nodeTypeId === compiled.spec.definition.ref.nodeTypeId
          ? compiled.spec
          : base.get(`${ref.nodeTypeId}@${ref.nodeTypeVersion}`),
      getAssetExpansionExact: (ref: { nodeTypeId: string }) =>
        ref.nodeTypeId === compiled.spec.definition.ref.nodeTypeId ? compiled.expansion : undefined,
    };
    const nodes: Record<string, GraphDocumentNode> = {
      asset: {
        id: "asset",
        definitionRef: compiled.spec.definition.ref,
        label: "Asset",
        config: { version: nodeConfigVersion(1), value: { threshold: 0.2 } },
      },
      missing: {
        id: "missing",
        definitionRef: exactNodeTypeRef("missing/plugin-view", "1.0.0"),
        label: "Missing",
      },
    };
    const edges = {
      inert: edge("inert", "asset", "out", "missing", "in"),
    };
    const runtime = new GraphRuntimeSession({
      resolver,
      document: { node: (id) => nodes[id], edges: () => Object.values(edges) },
      schedule: (flush) => flush(),
    });
    runtime.load({ nodes, edges, flags: {} });
    expect(() =>
      runtime.recookNode({
        ...nodes.asset,
        config: { version: nodeConfigVersion(1), value: { threshold: 0.9 } },
      }),
    ).not.toThrow();
    expect(runtime.pull("asset")).toEqual({ kind: "pred", sql: "score > 0.9" });
    runtime.dispose();
  });

  test("rebuilds parent expansions when an exact nested dependency changes", () => {
    const firstChild = compileNodeAsset(
      assetDefinition(),
      { getSpecExact: (ref) => (ref.nodeTypeId === filterSpec.definition.ref.nodeTypeId ? filterSpec : undefined) },
      { sourceId: "user", kind: "user" },
    );
    const changedFilterSpec: GraphRuntimeNodeSpec = {
      ...filterSpec,
      cook: () => ({ kind: "pred", sql: "changed = true" }),
    };
    const secondChild = compileNodeAsset(
      assetDefinition(),
      {
        getSpecExact: (ref) =>
          ref.nodeTypeId === changedFilterSpec.definition.ref.nodeTypeId ? changedFilterSpec : undefined,
      },
      { sourceId: "user", kind: "user" },
    );
    const parentDefinition = parseNodeAssetDefinition({
      schemaVersion: 1,
      assetId: "org.example/parent",
      assetVersion: "1.0.0",
      nodeTypeRef: exactNodeTypeRef("asset/org.example/parent", "1.0.0"),
      title: "Parent",
      dependencies: [
        {
          kind: "asset",
          assetRef: {
            assetId: assetDefinition().assetId,
            assetVersion: assetDefinition().assetVersion,
          },
        },
      ],
      nodes: [{ id: "child", definitionRef: firstChild.spec.definition.ref }],
      edges: [],
      inputs: [],
      outputs: [{ id: "out", label: "Out", kind: "pred", source: { nodeId: "child", portId: "out" } }],
      parameters: [],
      documentation: { summary: "Parent" },
      presentation: {},
      visibility: "public",
    });
    const compileParent = (child: typeof firstChild) =>
      compileNodeAsset(
        parentDefinition,
        { getSpecExact: (ref) => (ref.nodeTypeId === child.spec.definition.ref.nodeTypeId ? child.spec : undefined) },
        { sourceId: "user", kind: "user" },
      );
    const firstParent = compileParent(firstChild);
    const secondParent = compileParent(secondChild);
    let child = firstChild;
    let parent = firstParent;
    let filter = filterSpec;
    const resolver = {
      getSpecExact: (ref: { nodeTypeId: string }) =>
        ref.nodeTypeId === parent.spec.definition.ref.nodeTypeId
          ? parent.spec
          : ref.nodeTypeId === child.spec.definition.ref.nodeTypeId
            ? child.spec
            : ref.nodeTypeId === filter.definition.ref.nodeTypeId
              ? filter
              : undefined,
      getAssetExpansionExact: (ref: { nodeTypeId: string }) =>
        ref.nodeTypeId === parent.spec.definition.ref.nodeTypeId
          ? parent.expansion
          : ref.nodeTypeId === child.spec.definition.ref.nodeTypeId
            ? child.expansion
            : undefined,
    };
    const nodes = {
      parent: { id: "parent", definitionRef: firstParent.spec.definition.ref, label: "Parent" },
    };
    const topology = { nodes, edges: {}, flags: {} };
    const runtime = new GraphRuntimeSession({
      resolver,
      document: { node: (id) => nodes[id as keyof typeof nodes], edges: () => [] },
      schedule: (flush) => flush(),
    });
    runtime.load(topology);
    expect(runtime.pull("parent")).toEqual({ kind: "pred", sql: "score > 0.2" });

    child = secondChild;
    parent = secondParent;
    filter = changedFilterSpec;
    runtime.refreshResolutions(topology);
    expect(runtime.pull("parent")).toEqual({ kind: "pred", sql: "changed = true" });
    runtime.dispose();
  });

  test("expands nested assets with deterministic scoped ids and cleans every nested node", () => {
    const base = new Map<string, GraphRuntimeNodeSpec>([
      ["source@1.0.0", sourceSpec],
      ["filter@1.0.0", filterSpec],
      ["sink@1.0.0", sinkSpec],
    ]);
    const inner = compileNodeAsset(
      assetDefinition(),
      { getSpecExact: (ref) => base.get(`${ref.nodeTypeId}@${ref.nodeTypeVersion}`) },
      { sourceId: "user", kind: "user" },
    );
    const outerDefinition = parseNodeAssetDefinition({
      schemaVersion: 1,
      assetId: "org.example/nested",
      assetVersion: "1.0.0",
      nodeTypeRef: exactNodeTypeRef("asset/org.example/nested", "1.0.0"),
      title: "Nested",
      dependencies: [
        {
          kind: "asset",
          assetRef: { assetId: assetDefinition().assetId, assetVersion: assetDefinition().assetVersion },
        },
      ],
      nodes: [
        {
          id: "inner",
          definitionRef: inner.spec.definition.ref,
          config: { version: nodeConfigVersion(1), value: { threshold: 0.3 } },
        },
      ],
      edges: [],
      inputs: [{ id: "in", label: "In", kind: "pred", target: { nodeId: "inner", portId: "in" } }],
      outputs: [{ id: "out", label: "Out", kind: "pred", source: { nodeId: "inner", portId: "out" } }],
      parameters: [
        {
          id: "threshold",
          label: "Threshold",
          defaultValue: 0.3,
          target: { nodeId: "inner", configPath: ["threshold"] },
        },
      ],
      documentation: { summary: "Nested" },
      presentation: {},
      visibility: "public",
    });
    const outer = compileNodeAsset(
      outerDefinition,
      {
        getSpecExact: (ref) =>
          ref.nodeTypeId === inner.spec.definition.ref.nodeTypeId
            ? inner.spec
            : base.get(`${ref.nodeTypeId}@${ref.nodeTypeVersion}`),
      },
      { sourceId: "user", kind: "user" },
    );
    const resolver = {
      getSpecExact: (ref: { nodeTypeId: string; nodeTypeVersion: string }) =>
        ref.nodeTypeId === outer.spec.definition.ref.nodeTypeId
          ? outer.spec
          : ref.nodeTypeId === inner.spec.definition.ref.nodeTypeId
            ? inner.spec
            : base.get(`${ref.nodeTypeId}@${ref.nodeTypeVersion}`),
      getAssetExpansionExact: (ref: { nodeTypeId: string }) =>
        ref.nodeTypeId === outer.spec.definition.ref.nodeTypeId
          ? outer.expansion
          : ref.nodeTypeId === inner.spec.definition.ref.nodeTypeId
            ? inner.expansion
            : undefined,
    };
    const nodes: Record<string, GraphDocumentNode> = {
      source: { id: "source", definitionRef: sourceSpec.definition.ref, label: "Source" },
      nested: {
        id: "nested",
        definitionRef: outer.spec.definition.ref,
        label: "Nested",
        config: { version: nodeConfigVersion(1), value: { threshold: 0.9 } },
      },
      sink: { id: "sink", definitionRef: sinkSpec.definition.ref, label: "Sink" },
    };
    const edges = {
      e1: edge("e1", "source", "out", "nested", "in"),
      e2: edge("e2", "nested", "out", "sink", "in"),
    };
    const runtime = new GraphRuntimeSession({
      resolver,
      document: { node: (id) => nodes[id], edges: () => Object.values(edges) },
      schedule: (flush) => flush(),
    });
    runtime.load({ nodes, edges, flags: {} });
    const nestedFilterId = "nested::asset::inner::asset::filter";
    expect(runtime.isRegistered(nestedFilterId)).toBe(true);
    expect(runtime.pull("sink")).toEqual({ kind: "pred", sql: "(quality > 0.5) AND (score > 0.9)" });
    runtime.removeNode("nested");
    expect(runtime.isRegistered(nestedFilterId)).toBe(false);
    runtime.dispose();
  });
});
