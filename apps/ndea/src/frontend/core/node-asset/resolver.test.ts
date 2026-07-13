import { describe, expect, test } from "bun:test";
import { exactNodeTypeRef } from "@ndea/sdk";

import { createNativeAppNodeLibrary } from "../node/library";
import {
  canonicalUserNodeAssetBytes,
  createNodeAssetLibrary,
  linkedAssetRef,
  publishUserNodeAsset,
  type NodeAssetSource,
} from "./library";
import { compileNodeAssetSnapshot, createWorkspaceAppNodeLibrary, resolveWorkspaceNodeAssets } from "./resolver";
import { parseNodeAssetDefinition, type NodeAssetDefinition } from "./schema";

function asset(version: string, visibility: NodeAssetDefinition["visibility"] = "public") {
  return parseNodeAssetDefinition({
    schemaVersion: 1,
    assetId: "org.example/empty",
    assetVersion: version,
    nodeTypeRef: exactNodeTypeRef("asset/org.example/empty", version),
    title: `Empty ${version}`,
    dependencies: [{ kind: "node", definitionRef: exactNodeTypeRef("dataset", "1.0.0") }],
    nodes: [{ id: "dataset", definitionRef: exactNodeTypeRef("dataset", "1.0.0") }],
    edges: [],
    inputs: [],
    outputs: [{ id: "out", label: "Out", kind: "pred", source: { nodeId: "dataset", portId: "out" } }],
    parameters: [],
    documentation: { summary: "Empty" },
    presentation: {},
    visibility,
  });
}

function userSource(assets: readonly NodeAssetDefinition[], current = assets.at(-1)?.assetVersion): NodeAssetSource {
  return {
    sourceId: "user",
    kind: "user",
    assets,
    current: current ? { "org.example/empty": current } : {},
  };
}

describe("Workspace node asset resolution", () => {
  test("uses exact links, exact matching fallbacks, and restores the link when it returns", () => {
    const base = createNativeAppNodeLibrary();
    const v1 = asset("1.0.0");
    const record = {
      kind: "linked" as const,
      sourceId: "user",
      assetRef: linkedAssetRef("org.example/empty", "1.0.0"),
      nodeTypeRef: v1.nodeTypeRef,
      fallback: v1,
    };
    const missing = resolveWorkspaceNodeAssets(base, createNodeAssetLibrary([]), [record]);
    expect(missing.statusByNodeTypeRef["asset/org.example/empty@1.0.0"]).toBe("fallback");
    expect(missing.snapshot.getSpecExact(v1.nodeTypeRef)).toBeDefined();
    expect(missing.snapshot.assets.paletteEntries()).toEqual([]);

    const restored = resolveWorkspaceNodeAssets(base, createNodeAssetLibrary([userSource([v1])]), [record]);
    expect(restored.statusByNodeTypeRef["asset/org.example/empty@1.0.0"]).toBe("linked");
    expect(restored.snapshot.assets.getExact(record.assetRef)?.source.sourceId).toBe("user");

    const unresolved = resolveWorkspaceNodeAssets(base, createNodeAssetLibrary([]), [
      { ...record, fallback: undefined },
    ]);
    expect(unresolved.statusByNodeTypeRef["asset/org.example/empty@1.0.0"]).toBe("unresolved");
    expect(unresolved.snapshot.getSpecExact(v1.nodeTypeRef)).toBeUndefined();

    const afterFallbackRemoval = resolveWorkspaceNodeAssets(base, missing.snapshot.assets, [
      { ...record, fallback: undefined },
    ]);
    expect(afterFallbackRemoval.statusByNodeTypeRef["asset/org.example/empty@1.0.0"]).toBe("unresolved");
    expect(afterFallbackRemoval.snapshot.getSpecExact(v1.nodeTypeRef)).toBeUndefined();
  });

  test("never substitutes the wrong linked source or a changed exact fallback", () => {
    const base = createNativeAppNodeLibrary();
    const v1 = asset("1.0.0");
    const record = {
      kind: "linked" as const,
      sourceId: "user",
      assetRef: linkedAssetRef("org.example/empty", "1.0.0"),
      nodeTypeRef: v1.nodeTypeRef,
    };
    const wrapper = parseNodeAssetDefinition({
      schemaVersion: 1,
      assetId: "org.example/wrapper",
      assetVersion: "1.0.0",
      nodeTypeRef: exactNodeTypeRef("asset/org.example/wrapper", "1.0.0"),
      title: "Wrapper",
      dependencies: [{ kind: "asset", assetRef: record.assetRef }],
      nodes: [{ id: "inner", definitionRef: record.nodeTypeRef }],
      edges: [],
      inputs: [],
      outputs: [],
      parameters: [],
      documentation: { summary: "Wrapper" },
      presentation: {},
      visibility: "public",
    });
    const wrongSource = {
      sourceId: "project",
      kind: "project" as const,
      assets: [v1, wrapper],
      current: {
        "org.example/empty": "1.0.0",
        "org.example/wrapper": "1.0.0",
      },
      readOnly: true,
    };
    const unresolved = resolveWorkspaceNodeAssets(base, createNodeAssetLibrary([wrongSource]), [record]);
    expect(unresolved.statusByNodeTypeRef["asset/org.example/empty@1.0.0"]).toBe("unresolved");
    expect(unresolved.snapshot.getSpecExact(v1.nodeTypeRef)).toBeUndefined();

    const fallback = resolveWorkspaceNodeAssets(base, createNodeAssetLibrary([wrongSource]), [
      { ...record, fallback: v1 },
    ]);
    expect(fallback.statusByNodeTypeRef["asset/org.example/empty@1.0.0"]).toBe("fallback");
    expect(fallback.snapshot.assets.getExact(v1.nodeTypeRef)?.source.sourceId).toBe("workspace-fallback");

    const embedded = resolveWorkspaceNodeAssets(base, createNodeAssetLibrary([userSource([v1])]), [
      { kind: "embedded", definition: v1 },
    ]);
    expect(embedded.statusByNodeTypeRef["asset/org.example/empty@1.0.0"]).toBe("embedded");
    expect(embedded.snapshot.assets.getExact(v1.nodeTypeRef)?.source.sourceId).toBe("workspace");

    const changed = parseNodeAssetDefinition({ ...v1, title: "Changed exact bytes" });
    expect(() =>
      resolveWorkspaceNodeAssets(base, createNodeAssetLibrary([userSource([changed])]), [{ ...record, fallback: v1 }]),
    ).toThrow(/differs from exact fallback/);
  });

  test("keeps old exact specs while only current public assets enter new placement", () => {
    const base = createNativeAppNodeLibrary();
    const v1 = asset("1.0.0");
    const v2 = asset("2.0.0");
    const source = userSource([v1, v2]);
    const assets = createNodeAssetLibrary([source]);
    const library = createWorkspaceAppNodeLibrary(base, compileNodeAssetSnapshot(base, assets));

    expect(library.getSpecExact(v1.nodeTypeRef)).toBeDefined();
    expect(library.getCurrentSpec("asset/org.example/empty")?.definition.ref).toEqual(v2.nodeTypeRef);
    expect(
      library.paletteDescriptors().filter((entry) => entry.definitionRef.nodeTypeId === "asset/org.example/empty"),
    ).toHaveLength(1);

    const hidden = asset("3.0.0", "hidden");
    const hiddenLibrary = createWorkspaceAppNodeLibrary(
      base,
      compileNodeAssetSnapshot(base, createNodeAssetLibrary([userSource([v1, v2, hidden])])),
    );
    expect(hiddenLibrary.getSpecExact(hidden.nodeTypeRef)).toBeDefined();
    expect(
      hiddenLibrary
        .paletteDescriptors()
        .some((entry) => entry.definitionRef.nodeTypeVersion === hidden.nodeTypeRef.nodeTypeVersion),
    ).toBe(false);
  });

  test("storage denial preserves the previous immutable snapshot and canonical JSON is deterministic", () => {
    const v1 = asset("1.0.0");
    const v2 = asset("2.0.0");
    const library = createNodeAssetLibrary([userSource([v1])]);
    const before = canonicalUserNodeAssetBytes(library.sources()[0]);
    expect(() =>
      publishUserNodeAsset(library, "user", v2, {
        read: () => before,
        replaceAtomically: () => {
          throw new Error("permission denied");
        },
      }),
    ).toThrow(/permission denied/);
    expect(String(library.getCurrent("org.example/empty")?.definition.assetVersion)).toBe("1.0.0");
    expect(canonicalUserNodeAssetBytes(library.sources()[0])).toBe(before);
    expect(before).not.toContain("::asset::");
  });

  test("isolates stale node dependencies while compiling usable assets", () => {
    const usable = asset("1.0.0");
    const missingRef = exactNodeTypeRef("missing/plugin-node", "1.0.0");
    const broken = parseNodeAssetDefinition({
      schemaVersion: 1,
      assetId: "org.example/broken",
      assetVersion: "1.0.0",
      nodeTypeRef: exactNodeTypeRef("asset/org.example/broken", "1.0.0"),
      title: "Broken",
      dependencies: [{ kind: "node", definitionRef: missingRef }],
      nodes: [{ id: "missing", definitionRef: missingRef }],
      edges: [],
      inputs: [],
      outputs: [{ id: "out", label: "Out", kind: "pred", source: { nodeId: "missing", portId: "out" } }],
      parameters: [],
      documentation: { summary: "Broken" },
      presentation: {},
      visibility: "public",
    });
    const assets = createNodeAssetLibrary([
      {
        sourceId: "user",
        kind: "user",
        assets: [usable, broken],
        current: {
          "org.example/empty": "1.0.0",
          "org.example/broken": "1.0.0",
        },
      },
    ]);
    const base = createNativeAppNodeLibrary();
    const snapshot = compileNodeAssetSnapshot(base, assets);
    const library = createWorkspaceAppNodeLibrary(base, snapshot);

    expect(snapshot.getSpecExact(usable.nodeTypeRef)).toBeDefined();
    expect(snapshot.getSpecExact(broken.nodeTypeRef)).toBeUndefined();
    expect(snapshot.diagnostics()).toEqual([
      expect.objectContaining({ definitionRef: broken.nodeTypeRef, message: expect.stringMatching(/unavailable/) }),
    ]);
    expect(
      library
        .paletteDescriptors()
        .some((descriptor) => descriptor.definitionRef.nodeTypeId === "asset/org.example/empty"),
    ).toBe(true);
    expect(
      library
        .paletteDescriptors()
        .some((descriptor) => descriptor.definitionRef.nodeTypeId === "asset/org.example/broken"),
    ).toBe(false);
  });
});
