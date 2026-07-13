import { describe, expect, test } from "bun:test";
import { exactNodeTypeRef } from "@ndea/sdk";

import { createNodeAssetLibrary, linkedAssetRef, type NodeAssetSource } from "./library";
import { parseNodeAssetDefinition, type NodeAssetDefinition } from "./schema";

function asset(
  assetId: string,
  version: string,
  dependencies: NodeAssetDefinition["dependencies"] = [],
  visibility: NodeAssetDefinition["visibility"] = "public",
): NodeAssetDefinition {
  const nodes = dependencies
    .filter((dependency) => dependency.kind === "asset")
    .map((dependency, index) => ({
      id: `nested-${index}`,
      definitionRef: exactNodeTypeRef(`asset/${dependency.assetRef.assetId}`, dependency.assetRef.assetVersion),
    }));
  return parseNodeAssetDefinition({
    schemaVersion: 1,
    assetId,
    assetVersion: version,
    nodeTypeRef: exactNodeTypeRef(`asset/${assetId}`, version),
    title: `${assetId} ${version}`,
    dependencies,
    nodes,
    edges: [],
    inputs: [],
    outputs: [],
    parameters: [],
    documentation: { summary: assetId },
    presentation: {},
    visibility,
  });
}

function source(kind: NodeAssetSource["kind"], assets: readonly NodeAssetDefinition[]): NodeAssetSource {
  return {
    sourceId: kind,
    kind,
    assets,
    current: Object.fromEntries(assets.map((value) => [value.assetId, value.assetVersion])),
  };
}

describe("node asset library", () => {
  test("resolves exact/current while hiding utility assets only from the palette", () => {
    const v1 = asset("org.example/filter", "1.0.0");
    const v2 = asset("org.example/filter", "2.0.0");
    const hidden = asset("org.example/internal", "1.0.0", [], "hidden");
    const library = createNodeAssetLibrary([source("project", [v1]), source("user", [v2, hidden])]);

    expect(String(library.getExact(v1.nodeTypeRef)?.definition.assetVersion)).toBe("1.0.0");
    expect(String(library.getCurrent("org.example/filter")?.definition.assetVersion)).toBe("2.0.0");
    expect(library.getExact(hidden.nodeTypeRef)).toBeDefined();
    expect(library.paletteEntries().map((entry) => String(entry.definition.assetId))).toEqual(["org.example/filter"]);
    expect(Object.isFrozen(library.entries())).toBe(true);
  });

  test("rejects exact collisions and direct/indirect recursion with a full trace", () => {
    const same = asset("org.example/same", "1.0.0");
    expect(() => createNodeAssetLibrary([source("project", [same]), source("user", [same])])).toThrow(/collision/);

    const self = asset("org.example/self", "1.0.0", [
      { kind: "asset", assetRef: linkedAssetRef("org.example/self", "1.0.0") },
    ]);
    expect(() => createNodeAssetLibrary([source("user", [self])])).toThrow(/self@1.0.0.*self@1.0.0/);

    const a = asset("org.example/a", "1.0.0", [{ kind: "asset", assetRef: linkedAssetRef("org.example/b", "1.0.0") }]);
    const b = asset("org.example/b", "1.0.0", [{ kind: "asset", assetRef: linkedAssetRef("org.example/a", "1.0.0") }]);
    expect(() => createNodeAssetLibrary([source("user", [a, b])])).toThrow(/a@1.0.0.*b@1.0.0.*a@1.0.0/);
  });
});
