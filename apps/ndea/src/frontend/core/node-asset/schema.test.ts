import { describe, expect, test } from "bun:test";
import { exactNodeTypeRef, nodeConfigVersion } from "@ndea/sdk";

import { parseNodeAssetDefinition, nodeAssetId, nodeAssetVersion, type NodeAssetDefinition } from "./schema";
import { draftNextNodeAssetVersion, migrateNodeAssetDefinition } from "./migrations";

const valid: NodeAssetDefinition = {
  schemaVersion: 1,
  assetId: nodeAssetId("org.biohub.assets/high-quality"),
  assetVersion: nodeAssetVersion("1.2.0"),
  nodeTypeRef: exactNodeTypeRef("asset/org.biohub.assets/high-quality", "1.2.0"),
  title: "High quality",
  dependencies: [
    { kind: "node", definitionRef: exactNodeTypeRef("dataset", "1.0.0") },
    { kind: "node", definitionRef: exactNodeTypeRef("transform-filter", "1.0.0") },
  ],
  nodes: [
    { id: "source", definitionRef: exactNodeTypeRef("dataset", "1.0.0") },
    {
      id: "filter",
      definitionRef: exactNodeTypeRef("transform-filter", "1.0.0"),
      config: { version: nodeConfigVersion(1), value: { threshold: 0.5 } },
    },
  ],
  edges: [{ id: "wire", from: "source", fromPort: "out", to: "filter", toPort: "in", kind: "pred" }],
  inputs: [{ id: "predicate", label: "Predicate", kind: "pred", target: { nodeId: "filter", portId: "in" } }],
  outputs: [{ id: "out", label: "Out", kind: "pred", source: { nodeId: "filter", portId: "out" } }],
  parameters: [
    {
      id: "threshold",
      label: "Threshold",
      defaultValue: 0.5,
      target: { nodeId: "filter", configPath: ["threshold"] },
    },
  ],
  documentation: { summary: "Filters a dataset." },
  presentation: { accent: "#7c3aed", preferredBodySize: { width: 240, height: 120 } },
  visibility: "public",
};

describe("node asset schema", () => {
  test("strictly round-trips JSON-only declarative data", () => {
    const parsed = parseNodeAssetDefinition(JSON.parse(JSON.stringify(valid)));
    expect(parsed).toEqual(valid);
    expect(parseNodeAssetDefinition(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed);
  });

  test("rejects unknown keys, duplicates, non-JSON values, and node type/version aliasing", () => {
    expect(() => parseNodeAssetDefinition({ ...valid, executable: "return true" })).toThrow();
    expect(() => parseNodeAssetDefinition({ ...valid, title: undefined })).toThrow();
    expect(() => parseNodeAssetDefinition({ ...valid, documentation: { summary: () => "bad" } })).toThrow();
    expect(() => parseNodeAssetDefinition({ ...valid, nodes: [...valid.nodes, valid.nodes[0]] })).toThrow(
      /duplicate node id/,
    );
    expect(() => parseNodeAssetDefinition({ ...valid, outputs: [...valid.outputs, valid.outputs[0]] })).toThrow(
      /duplicate output port/,
    );
    expect(() =>
      parseNodeAssetDefinition({
        ...valid,
        parameters: [{ ...valid.parameters[0], defaultValue: Number.POSITIVE_INFINITY }],
      }),
    ).toThrow();
    expect(() => parseNodeAssetDefinition({ ...valid, dependencies: valid.dependencies.slice(0, 1) })).toThrow(
      /dependency mismatch/,
    );
    expect(() => parseNodeAssetDefinition({ ...valid, assetVersion: "2.0.0" })).toThrow(/node type version/);
  });

  test("edits through a detached next-version draft and rejects unknown schema versions", () => {
    const published = parseNodeAssetDefinition(JSON.parse(JSON.stringify(valid)));
    const draft = draftNextNodeAssetVersion(published, "1.3.0", { title: "High quality v2" });
    expect(String(draft.assetVersion)).toBe("1.3.0");
    expect(draft.nodeTypeRef).toEqual(exactNodeTypeRef("asset/org.biohub.assets/high-quality", "1.3.0"));
    expect(published.title).toBe("High quality");
    expect(String(published.assetVersion)).toBe("1.2.0");
    expect(() => migrateNodeAssetDefinition({ ...published, schemaVersion: 2 })).toThrow(/unsupported/);
  });
});
