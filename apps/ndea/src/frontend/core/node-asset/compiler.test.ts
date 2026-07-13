import { describe, expect, test } from "bun:test";
import { exactNodeTypeRef, nodeConfigVersion } from "@ndea/sdk";
import { z } from "zod";

import { compileNodeAsset, instantiateNodeAssetExpansion } from "./compiler";
import { parseNodeAssetDefinition } from "./schema";
import type { GraphRuntimeNodeSpec } from "../graph/runtime-session";

const source: GraphRuntimeNodeSpec = {
  definition: { ref: exactNodeTypeRef("source", "1.0.0"), inputs: [], outputs: [{ id: "out", kind: "pred" }] },
  evaluationRole: "source",
  cook: () => ({ kind: "pred", sql: "quality > 0.5" }),
};
const filter: GraphRuntimeNodeSpec = {
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
  cook: (inputs) => inputs.get("in")?.[0] ?? { kind: "pred", sql: null },
};
const specs = new Map<string, GraphRuntimeNodeSpec>([
  ["source@1.0.0", source],
  ["filter@1.0.0", filter],
]);
const resolver = {
  getSpecExact: (ref: { nodeTypeId: string; nodeTypeVersion: string }) =>
    specs.get(`${ref.nodeTypeId}@${ref.nodeTypeVersion}`),
};

function definition() {
  return parseNodeAssetDefinition({
    schemaVersion: 1,
    assetId: "org.example/filter",
    assetVersion: "1.0.0",
    nodeTypeRef: exactNodeTypeRef("asset/org.example/filter", "1.0.0"),
    title: "Filter",
    dependencies: [
      { kind: "node", definitionRef: source.definition.ref },
      { kind: "node", definitionRef: filter.definition.ref },
    ],
    nodes: [
      { id: "source", definitionRef: source.definition.ref },
      {
        id: "filter",
        definitionRef: filter.definition.ref,
        config: { version: nodeConfigVersion(1), value: { threshold: 0.2 } },
      },
    ],
    edges: [{ id: "e", from: "source", fromPort: "out", to: "filter", toPort: "in", kind: "pred" }],
    inputs: [],
    outputs: [{ id: "out", label: "Out", kind: "pred", source: { nodeId: "filter", portId: "out" } }],
    parameters: [
      {
        id: "threshold",
        label: "Threshold",
        defaultValue: 0.2,
        target: { nodeId: "filter", configPath: ["threshold"] },
      },
    ],
    documentation: { summary: "Filter" },
    presentation: {},
    visibility: "public",
  });
}

describe("node asset compiler", () => {
  test("validates exact ports/configs and creates deterministic flat expansion data", () => {
    const compiled = compileNodeAsset(definition(), resolver, { sourceId: "user", kind: "user" });
    const first = instantiateNodeAssetExpansion(compiled.expansion, "outer-1", { threshold: 0.8 });
    const second = instantiateNodeAssetExpansion(compiled.expansion, "outer-1", { threshold: 0.8 });

    expect(first).toEqual(second);
    expect(first.nodes.map((node) => node.id)).toEqual([
      "outer-1::asset::source",
      "outer-1::asset::filter",
      "outer-1::asset::out::out",
    ]);
    expect(first.nodes[1]?.config).toEqual({ version: nodeConfigVersion(1), value: { threshold: 0.8 } });
    expect(
      first.edges.some((edge) => edge.from === "outer-1::asset::filter" && edge.to === "outer-1::asset::out::out"),
    ).toBe(true);
  });

  test("rejects port/config incompatibility before returning a descriptor", () => {
    const badPort = { ...definition(), edges: [{ ...definition().edges[0], fromPort: "missing" }] };
    expect(() => compileNodeAsset(badPort, resolver, { sourceId: "user", kind: "user" })).toThrow(/source port/);

    const duplicateWire = {
      ...definition(),
      edges: [definition().edges[0], { ...definition().edges[0], id: "duplicate" }],
    };
    expect(() => compileNodeAsset(duplicateWire, resolver, { sourceId: "user", kind: "user" })).toThrow(
      /duplicates inner wire/,
    );

    expect(() =>
      compileNodeAsset({ ...definition(), outputs: [] }, resolver, { sourceId: "user", kind: "user" }),
    ).toThrow(/promote at least one output/);

    const badConfig = {
      ...definition(),
      nodes: definition().nodes.map((node) =>
        node.id === "filter" ? { ...node, config: { version: nodeConfigVersion(1), value: { threshold: 2 } } } : node,
      ),
    };
    expect(() => compileNodeAsset(badConfig, resolver, { sourceId: "user", kind: "user" })).toThrow(/config/);

    expect(() =>
      compileNodeAsset(
        definition(),
        {
          ...resolver,
          getCurrentSpec: (nodeTypeId) => (nodeTypeId === definition().nodeTypeRef.nodeTypeId ? source : undefined),
        },
        { sourceId: "user", kind: "user" },
      ),
    ).toThrow(/shadows/);
  });

  test("rejects duplicate parameter targets and invalid combined defaults during compilation", () => {
    const duplicateTarget = {
      ...definition(),
      parameters: [
        ...definition().parameters,
        {
          id: "threshold-copy",
          label: "Threshold copy",
          defaultValue: 0.3,
          target: { nodeId: "filter", configPath: ["threshold"] },
        },
      ],
    };
    expect(() => compileNodeAsset(duplicateTarget, resolver, { sourceId: "user", kind: "user" })).toThrow(
      /duplicates an existing config target/,
    );

    const rangeRef = exactNodeTypeRef("range", "1.0.0");
    const range: GraphRuntimeNodeSpec = {
      definition: {
        ref: rangeRef,
        inputs: [],
        outputs: [{ id: "out", kind: "pred" }],
        config: {
          version: 1,
          defaultValue: { min: 0, max: 10 },
          schema: z
            .object({ min: z.number(), max: z.number() })
            .strict()
            .refine(({ min, max }) => min <= max, "min must not exceed max"),
        },
      },
      evaluationRole: "source",
      cook: () => ({ kind: "pred", sql: null }),
    };
    const combinedInvalid = parseNodeAssetDefinition({
      schemaVersion: 1,
      assetId: "org.example/range",
      assetVersion: "1.0.0",
      nodeTypeRef: exactNodeTypeRef("asset/org.example/range", "1.0.0"),
      title: "Range",
      dependencies: [{ kind: "node", definitionRef: rangeRef }],
      nodes: [{ id: "range", definitionRef: rangeRef }],
      edges: [],
      inputs: [],
      outputs: [{ id: "out", label: "Out", kind: "pred", source: { nodeId: "range", portId: "out" } }],
      parameters: [
        {
          id: "min",
          label: "Min",
          defaultValue: 8,
          target: { nodeId: "range", configPath: ["min"] },
        },
        {
          id: "max",
          label: "Max",
          defaultValue: 2,
          target: { nodeId: "range", configPath: ["max"] },
        },
      ],
      documentation: { summary: "Range" },
      presentation: {},
      visibility: "public",
    });
    expect(() =>
      compileNodeAsset(
        combinedInvalid,
        { getSpecExact: (ref) => (ref.nodeTypeId === rangeRef.nodeTypeId ? range : undefined) },
        { sourceId: "user", kind: "user" },
      ),
    ).toThrow(/promoted parameters produce invalid config/);
  });
});
