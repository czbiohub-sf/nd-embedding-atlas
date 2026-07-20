import { beforeEach, describe, expect, test } from "bun:test";
import type { Metadata } from "@ndea/protocol";
import {
  PLUGIN_MANIFEST_SCHEMA_VERSION,
  PluginManifestSchema,
  SDK_VERSION,
  defineNode,
  exactNodeTypeRef,
  rowIndex,
} from "@ndea/sdk";
import { predicateSql } from "@/core/graph/cook";
import { createAppNodeLibrary, createNativeAppNodeLibrary, type AppNodeLibrary } from "@/core/node/library";
import { createNodeCatalog } from "@/core/plugin/catalog";
import { fromPersistedDoc, toPersistedDoc } from "./persist";
import { Workspace } from "./workspace-store";

const nativeWorkspaceNodeLibrary = createNativeAppNodeLibrary();

function createWorkspace(nodeLibrary: AppNodeLibrary = nativeWorkspaceNodeLibrary): Workspace {
  return new Workspace({
    coordinator: { query: () => Promise.resolve([]) } as never,
    table: "atlas",
    metadata: { dataset_keys: [] } as unknown as Metadata,
    nodeLibrary,
  });
}

beforeEach(() => {
  globalThis.requestAnimationFrame = (callback: FrameRequestCallback) => {
    callback(0);
    return 0;
  };
});

describe("Workspace graph transactions", () => {
  test("resolves every disposition and explicit placement against exact definition policy", () => {
    const workspace = createWorkspace();
    const stageable = workspace.addNode("scatter", { x: 0, y: 0 });
    const pinOnly = workspace.addNode("transform-filter", { x: 100, y: 0 });
    const canvasOnly = workspace.addNode("dataset", { x: 200, y: 0 });

    expect(workspace.placementOf(stageable)).toBe("staged");
    workspace.setDisposition("full");
    expect(workspace.placementOf(stageable)).toBe("embedded");
    workspace.setDisposition("hidden");
    expect(workspace.placementOf(stageable)).toBe("staged");
    workspace.togglePlacement(stageable, 0);
    expect(workspace.placementOf(stageable)).toBe("embedded");
    workspace.setDisposition("strip");
    expect(workspace.placementOf(stageable)).toBe("embedded");

    for (const disposition of ["full", "strip", "hidden"] as const) {
      workspace.setDisposition(disposition);
      expect(workspace.placementOf(pinOnly)).toBe("embedded");
      expect(workspace.placementOf(canvasOnly)).toBe("embedded");
    }
    workspace.dispose();
  });

  test("resolves node policy only through the injected immutable library", () => {
    expect(Object.isFrozen(nativeWorkspaceNodeLibrary)).toBe(true);
    const emptyLibrary: AppNodeLibrary = Object.freeze({
      catalog: nativeWorkspaceNodeLibrary.catalog,
      getSpecExact: (): undefined => {},
      getCurrentSpec: (): undefined => {},
      getDescriptorExact: (): undefined => {},
      getCurrentDescriptor: (): undefined => {},
      listSpecs: () => [],
      listDescriptors: () => [],
      paletteDescriptors: () => [],
    });
    const workspace = createWorkspace(emptyLibrary);
    expect(() => workspace.addNode("obs", { x: 0, y: 0 })).toThrow('no current node descriptor for type "obs"');
  });

  test("does not commit a document node when evaluator registration is unavailable", () => {
    const descriptorOnlyLibrary: AppNodeLibrary = Object.freeze({
      catalog: nativeWorkspaceNodeLibrary.catalog,
      getSpecExact: (): undefined => {},
      getCurrentSpec: (): undefined => {},
      getDescriptorExact: (ref: Parameters<AppNodeLibrary["getDescriptorExact"]>[0]) =>
        nativeWorkspaceNodeLibrary.getDescriptorExact(ref),
      getCurrentDescriptor: (nodeTypeId: string) => nativeWorkspaceNodeLibrary.getCurrentDescriptor(nodeTypeId),
      listSpecs: () => [],
      listDescriptors: () => nativeWorkspaceNodeLibrary.listDescriptors(),
      paletteDescriptors: () => nativeWorkspaceNodeLibrary.paletteDescriptors(),
    });
    const workspace = createWorkspace(descriptorOnlyLibrary);

    expect(() => workspace.addNode("count", { x: 0, y: 0 })).toThrow('no graph evaluator registered for "count@1.0.0"');
    expect(workspace.store.state.nodes).toEqual({});
    expect(workspace.store.state.positions).toEqual({});
    workspace.dispose();
  });

  test("a configless external definition cannot dirty or persist fabricated configuration", () => {
    const definition = defineNode({
      ref: exactNodeTypeRef("example/plain", "1.0.0"),
      title: "Plain",
      role: "transform",
      inputs: [],
      outputs: [{ id: "out", kind: "pred", label: "Out" }],
      capabilities: [] as const,
      evaluate: () => new Map([["out", null]]),
    });
    const source = {
      kind: "plugin" as const,
      manifest: PluginManifestSchema.parse({
        manifestSchemaVersion: PLUGIN_MANIFEST_SCHEMA_VERSION,
        pluginId: "example",
        pluginPackageVersion: "1.0.0",
        sdkVersionRange: String(SDK_VERSION),
        displayName: "Example",
        clientEntry: "index.js",
        hostCompatibility: { hostVersionRange: "*" },
        license: "MIT",
        permissions: [],
      }),
    };
    const nodeLibrary = createAppNodeLibrary(createNodeCatalog([{ source, definitions: [definition] }]), []);
    const workspace = createWorkspace(nodeLibrary);
    const id = workspace.addNode("example/plain", { x: 0, y: 0 });
    const before = structuredClone(workspace.store.state);
    let storeChanges = 0;
    const subscription = workspace.store.subscribe(() => {
      storeChanges += 1;
    });

    expect(() => workspace.updateNodeConfig(id, { fabricated: true })).toThrow(
      `node "${id}" does not accept configuration`,
    );
    expect(workspace.store.state).toEqual(before);
    expect(storeChanges).toBe(0);
    expect(fromPersistedDoc(toPersistedDoc(workspace.store.state), nodeLibrary)).toEqual({
      ok: true,
      state: workspace.store.state,
    });
    subscription.unsubscribe();
    workspace.dispose();
  });

  test("publishes an SDK host config patch only after synchronous sinks recook it", () => {
    const workspace = createWorkspace();
    const dataset = workspace.addNode("dataset", { x: 0, y: 0 });
    const count = workspace.addNode("count", { x: 100, y: 0 });
    expect(workspace.connect(dataset, count)).toBe(true);

    let sinkPredicate: string | null | undefined;
    const unregister = workspace.registerGraphSink(count, (value) => {
      sinkPredicate = predicateSql(value);
    });
    let subscriberPredicate: string | null | undefined;
    const subscription = workspace.store.subscribe(() => {
      if (
        (workspace.store.state.nodes[dataset]?.config?.value as { datasetKey?: string } | undefined)?.datasetKey ===
        "donor-a"
      ) {
        subscriberPredicate = predicateSql(workspace.pullGraphNode(count));
      }
    });

    workspace.updateNodeConfig(dataset, { datasetKey: "donor-a" });

    expect(sinkPredicate).toBe("_dataset = 'donor-a'");
    expect(subscriberPredicate).toBe("_dataset = 'donor-a'");
    subscription.unsubscribe();
    unregister();
    workspace.dispose();
  });

  test("removing a checkpoint clears its runtime projection before ID reuse", () => {
    const workspace = createWorkspace();
    const scatter = workspace.addNode("scatter", { x: 0, y: 0 });
    const cache = workspace.addNode("cache", { x: 0, y: 0 }, "reused-cache");
    expect(workspace.connect(scatter, cache)).toBe(true);
    workspace.emitLasso(scatter, "__row_index__ IN (11, 12)", [rowIndex(11), rowIndex(12)]);
    expect(workspace.pinCache(cache)).toBe(true);
    expect(workspace.isCached(cache)).toBe(true);

    workspace.removeNode(cache);
    workspace.addNode("cache", { x: 0, y: 0 }, cache);

    expect(workspace.isCached(cache)).toBe(false);
    workspace.dispose();
  });

  test("publishes a connection only after its evaluator projection is live", () => {
    const workspace = createWorkspace();
    const dataset = workspace.addNode("dataset", { x: 0, y: 0 });
    const count = workspace.addNode("count", { x: 100, y: 0 });
    workspace.updateNodeConfig(dataset, { datasetKey: "plate-a" });

    let predicateSeenByDocumentSubscriber: string | null | undefined;
    const subscription = workspace.store.subscribe(() => {
      if (Object.keys(workspace.store.state.edges).length === 1) {
        predicateSeenByDocumentSubscriber = predicateSql(workspace.pullGraphNode(count));
      }
    });

    expect(workspace.connect(dataset, count)).toBe(true);
    expect(predicateSeenByDocumentSubscriber).toBe("_dataset = 'plate-a'");
    subscription.unsubscribe();
    workspace.dispose();
  });

  test("publishes an edge deletion only after evaluator disconnection", () => {
    const workspace = createWorkspace();
    const dataset = workspace.addNode("dataset", { x: 0, y: 0 });
    const count = workspace.addNode("count", { x: 100, y: 0 });
    workspace.updateNodeConfig(dataset, { datasetKey: "plate-a" });
    expect(workspace.connect(dataset, count)).toBe(true);
    const edgeId = Object.keys(workspace.store.state.edges)[0];

    let predicateSeenByDocumentSubscriber: string | null | undefined = "not-observed";
    const subscription = workspace.store.subscribe(() => {
      if (Object.keys(workspace.store.state.edges).length === 0) {
        predicateSeenByDocumentSubscriber = predicateSql(workspace.pullGraphNode(count));
      }
    });

    workspace.deleteEdge(edgeId);
    expect(predicateSeenByDocumentSubscriber).toBeNull();
    subscription.unsubscribe();
    workspace.dispose();
  });

  test("node and edge removal clear only editor selections that reference dropped graph records", () => {
    const workspace = createWorkspace();
    const source = workspace.addNode("dataset", { x: 0, y: 0 });
    const sink = workspace.addNode("count", { x: 100, y: 0 });
    expect(workspace.connect(source, sink)).toBe(true);
    const edgeId = Object.keys(workspace.store.state.edges)[0];

    workspace.setGraphSelection([source, sink], [edgeId]);
    workspace.deleteEdge(edgeId);
    expect(workspace.store.state.selectedNodeIds).toEqual([source, sink]);
    expect(workspace.store.state.selectedEdgeId).toBeNull();

    expect(workspace.connect(source, sink)).toBe(true);
    const replacementEdgeId = Object.keys(workspace.store.state.edges)[0];
    workspace.setGraphSelection([source, sink], [replacementEdgeId]);
    workspace.removeNode(sink);
    expect(workspace.store.state.selectedNodeId).toBeNull();
    expect(workspace.store.state.selectedNodeIds).toEqual([source]);
    expect(workspace.store.state.selectedEdgeId).toBeNull();
    workspace.dispose();
  });

  test("node click, marquee, edge Escape, and node Escape leave focus and claim independent", () => {
    const workspace = createWorkspace();
    const first = workspace.addNode("dataset", { x: 0, y: 0 });
    const second = workspace.addNode("count", { x: 100, y: 0 });
    expect(workspace.connect(first, second)).toBe(true);
    const edgeId = Object.keys(workspace.store.state.edges)[0];
    workspace.coordination.assignScope(first, "focus", "A");
    workspace.coordination.setCoordinationValue("focus", "A", rowIndex(7));
    workspace.claim(second);

    workspace.selectNode(first);
    expect(workspace.store.state.selectedNodeId).toBe(first);
    expect(workspace.store.state.selectedNodeIds).toEqual([]);

    workspace.setGraphSelection([first, second], []);
    expect(workspace.store.state.selectedNodeId).toBeNull();
    expect(workspace.store.state.selectedNodeIds).toEqual([first, second]);

    workspace.selectEdge(edgeId);
    workspace.selectEdge(null); // first Escape step: edge only
    expect(workspace.store.state.selectedNodeIds).toEqual([first, second]);
    workspace.setGraphSelection([], []); // next Escape step: node selection only
    expect(workspace.store.state.selectedNodeId).toBeNull();
    expect(workspace.store.state.selectedNodeIds).toEqual([]);
    expect(workspace.store.state.selectedEdgeId).toBeNull();
    expect(workspace.store.state.claimed).toBe(second);
    expect(workspace.coordination.readCoordination("focus", "A")).toBe(rowIndex(7));
    workspace.dispose();
  });

  test("keeps predicate, row-set, focus, editor, coordination, placement, and disposition state independent", () => {
    const workspace = createWorkspace();
    const dataset = workspace.addNode("dataset", { x: 0, y: 0 });
    const count = workspace.addNode("count", { x: 100, y: 0 });
    const scatter = workspace.addNode("scatter", { x: 200, y: 0 });
    const table = workspace.addNode("table", { x: 300, y: 0 });
    const imageViewer = workspace.addNode("image-viewer", { x: 400, y: 0 });
    expect(workspace.connect(dataset, count)).toBe(true);
    expect(workspace.connect(table, imageViewer)).toBe(true);
    workspace.updateNodeConfig(dataset, { datasetKey: "plate-a" });

    let focused: ReturnType<typeof rowIndex> | null = null;
    const unregister = workspace.registerGraphSink(imageViewer, (value) => {
      if (value.kind === "focus") focused = value.rowIndex;
    });
    workspace.emitLasso(scatter, "__row_index__ IN (2, 5)", [rowIndex(2), rowIndex(5)]);
    workspace.emitFocus(table, rowIndex(9));
    workspace.coordination.assignScope(scatter, "focus", "A");
    workspace.coordination.setCoordinationValue("focus", "A", rowIndex(7));
    workspace.setGraphSelection([scatter, table], []);
    workspace.setStageTree("__slot");
    workspace.fillSlot("__slot", imageViewer);
    workspace.setDisposition("hidden");

    expect(predicateSql(workspace.pullGraphNode(count))).toBe("_dataset = 'plate-a'");
    expect(workspace.getLasso(scatter)?.rowIds).toEqual([rowIndex(2), rowIndex(5)]);
    expect(Number(focused)).toBe(9);
    expect(workspace.coordination.readCoordination("focus", "A")).toBe(rowIndex(7));
    expect(workspace.store.state.selectedNodeIds).toEqual([scatter, table]);
    expect(workspace.store.state.explicit[imageViewer]).toBe("staged");
    expect(workspace.store.state.stageTree).toBe(imageViewer);
    expect(workspace.store.state.disposition).toBe("hidden");
    unregister();
    workspace.dispose();
  });

  test("rejects an illegal cycle without committing document topology", () => {
    const workspace = createWorkspace();
    const first = workspace.addNode("wrangle", { x: 0, y: 0 });
    const second = workspace.addNode("wrangle", { x: 100, y: 0 });
    expect(workspace.connect(first, second)).toBe(true);
    const edgeIds = Object.keys(workspace.store.state.edges);

    expect(workspace.connect(second, first)).toBe(false);
    expect(Object.keys(workspace.store.state.edges)).toEqual(edgeIds);
    workspace.dispose();
  });

  test("hydrates document topology once, after the evaluator projection is complete", () => {
    const source = createWorkspace();
    const dataset = source.addNode("dataset", { x: 0, y: 0 });
    const count = source.addNode("count", { x: 100, y: 0 });
    source.updateNodeConfig(dataset, { datasetKey: "plate-a" });
    expect(source.connect(dataset, count)).toBe(true);

    const destination = createWorkspace();
    let notifications = 0;
    let hydratedPredicate: string | null | undefined;
    const subscription = destination.store.subscribe(() => {
      notifications += 1;
      hydratedPredicate = predicateSql(destination.pullGraphNode(count));
    });

    destination.loadDocument(source.store.state);
    expect(notifications).toBe(1);
    expect(hydratedPredicate).toBe("_dataset = 'plate-a'");
    subscription.unsubscribe();
    source.dispose();
    destination.dispose();
  });

  test("loads unresolved node records and incident edges without evaluator registration", () => {
    const source = createWorkspace();
    const dataset = source.addNode("dataset", { x: 0, y: 0 });
    const unknownId = "external-missing";
    const unknownEdgeId = "e900";
    const state = {
      ...source.store.state,
      nodes: {
        ...source.store.state.nodes,
        [unknownId]: {
          id: unknownId,
          definitionRef: exactNodeTypeRef("external-missing", "1.0.0"),
          label: "Unavailable plugin",
        },
      },
      positions: { ...source.store.state.positions, [unknownId]: { x: 200, y: 100 } },
      edges: {
        ...source.store.state.edges,
        [unknownEdgeId]: {
          id: unknownEdgeId,
          from: dataset,
          fromPort: "out",
          to: unknownId,
          toPort: "in",
          kind: "pred" as const,
        },
      },
      selectedNodeId: unknownId,
    };
    const destination = createWorkspace();

    destination.loadDocument(state);

    expect(destination.store.state.nodes[unknownId]).toEqual(state.nodes[unknownId]);
    expect(destination.store.state.edges[unknownEdgeId]).toEqual(state.edges[unknownEdgeId]);
    expect(destination.store.state.selectedNodeId).toBe(unknownId);
    expect(destination.nodeResolution(unknownId)?.status).toBe("unresolved");
    expect(destination.unresolvedNodes().map(({ id }) => id)).toEqual([unknownId]);

    destination.removeNode(unknownId);
    expect(destination.store.state.nodes[unknownId]).toBeUndefined();
    expect(destination.store.state.edges[unknownEdgeId]).toBeUndefined();
    source.dispose();
    destination.dispose();
  });

  test("leaves both document and evaluator empty when loaded topology validation fails", () => {
    const source = createWorkspace();
    const first = source.addNode("wrangle", { x: 0, y: 0 });
    const second = source.addNode("wrangle", { x: 100, y: 0 });
    expect(source.connect(first, second)).toBe(true);
    const invalidState = {
      ...source.store.state,
      edges: {
        ...source.store.state.edges,
        reverse: { id: "reverse", from: second, fromPort: "out", to: first, toPort: "in", kind: "pred" as const },
      },
    };
    const destination = createWorkspace();

    expect(() => destination.loadDocument(invalidState)).toThrow('graph runtime rejected edge "reverse"');
    expect(destination.store.state.nodes).toEqual({});
    expect(destination.store.state.edges).toEqual({});
    expect(destination.addNode("count", { x: 0, y: 0 }, first)).toBe(first);
    source.dispose();
    destination.dispose();
  });
});
