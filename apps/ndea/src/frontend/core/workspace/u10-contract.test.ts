import { describe, expect, test } from "bun:test";
import {
  PLUGIN_MANIFEST_SCHEMA_VERSION,
  PluginManifestSchema,
  SDK_VERSION,
  defineNode,
  exactNodeTypeRef,
  nodeConfigVersion,
  rowIndex,
} from "@ndea/sdk";
import type { Metadata } from "@ndea/protocol";

import type { GraphDocumentNode } from "@/core/graph/records";
import { createAppNodeLibrary, createNativeAppNodeLibrary } from "@/core/node/library";
import { createNodeCatalog } from "@/core/plugin/catalog";
import { Workspace } from "./workspace-store";
import type { WorkspaceDocumentState } from "./types";
import {
  DOC_VERSION,
  fromPersistedDoc,
  loadFromStorage,
  migrate,
  saveToStorage,
  toPersistedDoc,
  WorkspaceAutosave,
  type WorkspaceStorage,
} from "./persist";

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
    explicit: {},
    stageTree: null,
    disposition: "strip",
    stripH: 280,
    claimed: null,
    graphPath: null,
    flags: {},
    coordinationScopes: {},
    coordinationSpace: {},
  };
}

function memoryStorage(initial: Record<string, string> = {}): WorkspaceStorage & { bytes: Record<string, string> } {
  const bytes = { ...initial };
  return {
    bytes,
    read: (key) => bytes[key] ?? null,
    write: (key, value) => {
      bytes[key] = value;
    },
  };
}

function v2Document(type = "dataset", config: unknown = { datasetKey: "plate" }) {
  const state = emptyState() as unknown as Record<string, unknown>;
  state.nodes = {
    d1: { id: "d1", type, kind: "source", label: "Authored label", pluginId: null, config },
  };
  state.selection = "d1";
  state.selSet = ["d1"];
  state.selectedEdge = null;
  state.coordinationSpace = { focus: { A: "8" } };
  delete state.selectedNodeId;
  delete state.selectedNodeIds;
  delete state.selectedEdgeId;
  return { version: 2, state };
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
  test("1. v6 writes exact refs, versioned configs, canonical editor names, and numeric focus only", () => {
    const state = emptyState();
    state.nodes.d1 = {
      id: "d1",
      definitionRef: datasetRef,
      label: "Authored label",
      config: { version: nodeConfigVersion(1), value: { datasetKey: "plate" } },
    };
    state.selectedNodeId = "d1";
    state.selectedNodeIds = ["d1"];
    state.coordinationSpace = { focus: { A: rowIndex(8) } };

    const raw = JSON.stringify(toPersistedDoc(state));
    expect(JSON.parse(raw)).toEqual({
      version: 6,
      state: expect.objectContaining({
        nodes: {
          d1: {
            id: "d1",
            definitionRef: { nodeTypeId: "dataset", nodeTypeVersion: "1.0.0" },
            label: "Authored label",
            config: { version: 1, value: { datasetKey: "plate" } },
          },
        },
        selectedNodeId: "d1",
        selectedNodeIds: ["d1"],
        selectedEdgeId: null,
        coordinationSpace: { focus: { A: 8 } },
      }),
    });
    for (const retired of ['"type"', '"kind"', '"pluginId"', '"selection"', '"selSet"', '"selectedEdge"']) {
      expect(raw).not.toContain(retired);
    }
    expect(DOC_VERSION).toBe(6);
  });

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

    globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      callback(0);
      return 0;
    }) as typeof requestAnimationFrame;
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

  test("4. v2 retired IDs, ports, and unversioned config migrate explicitly", () => {
    const legacy = v2Document("threshold", { column: 'score"raw', threshold: 0 });
    (legacy.state.nodes as Record<string, unknown>).viewer = {
      id: "viewer",
      type: "fov",
      kind: "view",
      label: "Viewer",
      pluginId: null,
    };
    (legacy.state.edges as Record<string, unknown>).e1 = {
      id: "e1",
      from: "d1",
      fromPort: "selection-out",
      to: "viewer",
      toPort: "highlight-in",
      kind: "focus",
    };
    const out = migrate(legacy, library);
    expect(out.version).toBe(6);
    expect(out.state.nodes.d1).toEqual({
      id: "d1",
      definitionRef: exactNodeTypeRef("transform-filter", "1.0.0"),
      label: "Authored label",
      config: { version: nodeConfigVersion(1), value: { column: 'score"raw', threshold: 0 } },
    });
    expect(out.state.edges.e1.toPort).toBe("focus-in");
    expect(out.state.selectedNodeId).toBe("d1");
    expect(out.state.coordinationSpace.focus?.A).toBe(rowIndex(8));
  });

  test("5. step migration is pure and idempotent", () => {
    const legacy = v2Document();
    const before = structuredClone(legacy);
    const once = migrate(legacy, library);
    const twice = migrate(once, library);
    expect(legacy).toEqual(before);
    expect(twice).toEqual(once);
  });

  test("6. v3 older config snapshots use the public SDK migration chain", () => {
    const state = emptyState();
    state.nodes.d1 = {
      id: "d1",
      definitionRef: datasetRef,
      label: "Dataset",
      config: { version: nodeConfigVersion(0), value: {} },
    };
    const storage = memoryStorage({ active: JSON.stringify(toPersistedDoc(state)) });
    const loaded = loadFromStorage(storage, "active", library);
    expect(loaded.kind).toBe("ok");
    if (loaded.kind === "ok")
      expect(loaded.state.nodes.d1.config).toEqual({
        version: nodeConfigVersion(1),
        value: { datasetKey: null },
      });
  });

  test("7. future and missing config migrators enter recovery without rewriting", () => {
    const state = emptyState();
    state.nodes.d1 = {
      id: "d1",
      definitionRef: datasetRef,
      label: "Dataset",
      config: { version: nodeConfigVersion(99), value: {} },
    };
    const raw = JSON.stringify(toPersistedDoc(state));
    const storage = memoryStorage({ active: raw });
    expect(loadFromStorage(storage, "active", library)).toMatchObject({ kind: "recovery", stage: "config" });
    expect(storage.bytes.active).toBe(raw);

    state.nodes.d1 = {
      id: "d1",
      definitionRef: exactNodeTypeRef("annotate", "1.0.0"),
      label: "Annotate",
      config: { version: nodeConfigVersion(0), value: {} },
    };
    const missingRaw = JSON.stringify(toPersistedDoc(state));
    const missingStorage = memoryStorage({ active: missingRaw });
    expect(loadFromStorage(missingStorage, "active", library)).toMatchObject({
      kind: "recovery",
      stage: "config",
    });
    expect(missingStorage.bytes.active).toBe(missingRaw);
  });

  test("8. old bytes are backed up and verified before one canonical rewrite", () => {
    const raw = JSON.stringify(v2Document());
    const writes: string[] = [];
    const storage = memoryStorage({ active: raw });
    const write = storage.write;
    storage.write = (key, value) => {
      writes.push(key);
      write(key, value);
    };
    expect(loadFromStorage(storage, "active", library).kind).toBe("ok");
    expect(storage.bytes["active.backup.v2"]).toBe(raw);
    expect(JSON.parse(storage.bytes.active).version).toBe(6);
    expect(writes).toEqual(["active.backup.v2", "active"]);
  });

  test("9. backup denial preserves active bytes and exposes recovery", () => {
    const raw = JSON.stringify(v2Document());
    const storage = memoryStorage({ active: raw });
    storage.write = () => {
      throw new Error("denied");
    };
    expect(loadFromStorage(storage, "active", library)).toMatchObject({
      kind: "recovery",
      stage: "backup-write",
      backupKey: "active.backup.v2",
    });
    expect(storage.bytes.active).toBe(raw);
  });

  test("10. unresolved exact definitions preserve records, configs, edges, and selection", () => {
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
    const decoded = fromPersistedDoc(toPersistedDoc(state), library);
    expect(decoded).toEqual({ ok: true, state });
  });

  test("11. autosave write errors are observable and never swallowed", () => {
    let attempts = 0;
    const failures: string[] = [];
    const storage: WorkspaceStorage = {
      read: () => null,
      write: () => {
        attempts += 1;
        throw new Error("quota");
      },
    };
    expect(() => saveToStorage(storage, "active", emptyState())).toThrow("quota");
    const autosave = new WorkspaceAutosave(storage, "active", (error) => failures.push(String(error)));
    expect(autosave.save(emptyState())).toBe(false);
    expect(autosave.save(emptyState())).toBe(false);
    expect(attempts).toBe(2);
    expect(failures).toEqual(["Error: quota"]);
  });
});
