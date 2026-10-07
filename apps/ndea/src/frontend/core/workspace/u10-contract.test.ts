import { describe, expect, test } from "bun:test";
import {
  PLUGIN_MANIFEST_SCHEMA_VERSION,
  PluginManifestSchema,
  SDK_VERSION,
  defineNode,
  exactNodeTypeRef,
  nodeConfigVersion,
} from "@ndea/sdk";
import type { Metadata } from "@ndea/protocol";

import type { GraphDocumentNode } from "@/core/graph/records";
import { createAppNodeLibrary, createNativeAppNodeLibrary } from "@/core/node/library";
import { createNodeCatalog } from "@/core/plugin/catalog";
import { Workspace } from "./workspace-store";
import type { WorkspaceDocumentState } from "./types";
import { toWorkspaceDocument, workspaceSessionOf } from "./document";
import { decodeWorkspaceDocument } from "./sync";

const library = createNativeAppNodeLibrary();
const datasetRef = exactNodeTypeRef("dataset", "1.0.0");

function emptyState(): WorkspaceDocumentState {
  return {
    nodeAssets: [],
    nodes: {},
    edges: {},
    positions: {},
    sizeOverrides: {},
    formOverride: {},
    formLocked: {},
    selectedNodeId: null,
    selectedNodeIds: [],
    selectedEdgeId: null,
    stage: null,
    disposition: "strip",
    stripH: 280,
    claimed: null,
    graphPath: null,
    flags: {},
    state: {},
    bindings: {},
  };
}

function versionedDefinition(nodeTypeVersion: string, sql: string) {
  return defineNode({
    ref: exactNodeTypeRef("example/dual", nodeTypeVersion),
    title: `Dual ${nodeTypeVersion}`,
    role: "transform",
    inputs: [],
    outputs: [{ id: "out", kind: "pred", label: "Out" }],
    capabilities: ["compute"] as const,
    evaluate: () => new Map([["out", sql]]),
  });
}

describe("U10 exact-reference persistence contract", () => {
  test("2. two exact versions coexist, execute exactly, and current placement chooses current", () => {
    const v1 = versionedDefinition("1.0.0", "version = 1");
    const v2 = versionedDefinition("2.0.0", "version = 2");
    const source = {
      kind: "plugin" as const,
      manifest: PluginManifestSchema.parse({
        manifestSchemaVersion: PLUGIN_MANIFEST_SCHEMA_VERSION,
        pluginId: "example",
        pluginPackageVersion: "2.0.0",
        sdkVersionRange: String(SDK_VERSION),
        displayName: "Example",
        clientEntry: "index.js",
        hostCompatibility: { hostVersionRange: "*" },
        license: "MIT",
        permissions: [],
      }),
    };
    const versionedLibrary = createAppNodeLibrary(createNodeCatalog([{ source, definitions: [v1, v2] }]), []);
    expect(versionedLibrary.listSpecs().map(({ definition }) => definition.ref)).toEqual([v1.ref, v2.ref]);
    expect(versionedLibrary.getSpecExact(v1.ref)?.definition).toBe(v1);
    expect(versionedLibrary.getSpecExact(v2.ref)?.definition).toBe(v2);

    globalThis.requestAnimationFrame = (callback: FrameRequestCallback) => {
      callback(0);
      return 0;
    };
    const workspace = new Workspace({
      coordinator: { query: () => Promise.resolve([]) } as never,
      table: "atlas",
      metadata: { dataset_keys: [] } as unknown as Metadata,
      nodeLibrary: versionedLibrary,
    });
    const currentId = workspace.addNode("example/dual", { x: 0, y: 0 });
    expect(workspace.store.state.nodes[currentId].definitionRef).toEqual(v2.ref);
    expect(workspace.pullGraphNode(currentId)).toEqual({ kind: "pred", sql: "version = 2" });
    workspace.dispose();

    const restored = new Workspace({
      coordinator: { query: () => Promise.resolve([]) } as never,
      table: "atlas",
      metadata: { dataset_keys: [] } as unknown as Metadata,
      nodeLibrary: versionedLibrary,
    });
    const state = emptyState();
    state.nodes.v1 = { id: "v1", definitionRef: v1.ref, label: "Old" };
    state.nodes.v2 = { id: "v2", definitionRef: v2.ref, label: "Current" };
    restored.loadDocument(state);
    expect(restored.pullGraphNode("v1")).toEqual({ kind: "pred", sql: "version = 1" });
    expect(restored.pullGraphNode("v2")).toEqual({ kind: "pred", sql: "version = 2" });
    restored.dispose();
  });

  test("3. palette projects only each catalog type's current compatible version", () => {
    const refs = library.paletteDescriptors().map((descriptor) => descriptor.definitionRef);
    expect(new Set(refs.map((ref) => ref.nodeTypeId)).size).toBe(refs.length);
    for (const ref of refs) expect(library.catalog.resolveCurrent(ref.nodeTypeId)?.ref).toEqual(ref);
  });

  test("6. older config snapshots use the public SDK migration chain", () => {
    const state = emptyState();
    state.nodes.d1 = {
      id: "d1",
      definitionRef: datasetRef,
      label: "Dataset",
      config: { version: nodeConfigVersion(0), value: {} },
    };
    const decoded = decodeWorkspaceDocument(toWorkspaceDocument(state), library);
    expect(decoded.ok && decoded.state.nodes.d1.config).toEqual({
      version: nodeConfigVersion(1),
      value: { datasetKey: null },
    });
  });

  test("7. future and missing config migrators reject the document", () => {
    const state = emptyState();
    state.nodes.d1 = {
      id: "d1",
      definitionRef: datasetRef,
      label: "Dataset",
      config: { version: nodeConfigVersion(99), value: {} },
    };
    expect(decodeWorkspaceDocument(toWorkspaceDocument(state), library).ok).toBe(false);

    state.nodes.d1 = {
      id: "d1",
      definitionRef: exactNodeTypeRef("annotate", "1.0.0"),
      label: "Annotate",
      config: { version: nodeConfigVersion(0), value: {} },
    };
    expect(decodeWorkspaceDocument(toWorkspaceDocument(state), library).ok).toBe(false);
  });

  test("10. unresolved exact definitions preserve records, configs, edges, and session", () => {
    const state = emptyState();
    const unavailable: GraphDocumentNode = {
      id: "x1",
      definitionRef: exactNodeTypeRef("third-party/write-back", "4.2.0"),
      label: "Still here",
      config: { version: nodeConfigVersion(17), value: { opaque: [1, null, "x"] } },
    };
    state.nodes.x1 = unavailable;
    state.edges.e1 = { id: "e1", from: "x1", fromPort: "out", to: "x1", toPort: "in", kind: "pred" };
    state.positions.x1 = { x: 10, y: 20 };
    state.selectedNodeId = "x1";
    expect(decodeWorkspaceDocument(toWorkspaceDocument(state), library, workspaceSessionOf(state))).toEqual({
      ok: true,
      state,
    });
  });
});
