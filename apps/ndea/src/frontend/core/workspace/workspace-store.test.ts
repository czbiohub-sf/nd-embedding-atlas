import { beforeEach, describe, expect, test } from "bun:test";
import type { Metadata } from "@ndea/protocol";
import { rowIndex } from "@ndea/sdk";
import { predicateSql } from "@/core/graph/cook";
import { nativeWorkspaceNodeLibrary } from "./definitions";
import type { WorkspaceNodeLibrary } from "./node-projection";
import { Workspace } from "./workspace-store";

function createWorkspace(nodeLibrary: WorkspaceNodeLibrary = nativeWorkspaceNodeLibrary): Workspace {
  return new Workspace({
    coordinator: { query: () => Promise.resolve([]) } as never,
    table: "atlas",
    metadata: { dataset_keys: [] } as unknown as Metadata,
    nodeLibrary,
  });
}

beforeEach(() => {
  globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
    callback(0);
    return 0;
  }) as typeof requestAnimationFrame;
});

describe("Workspace graph transactions", () => {
  test("resolves node policy only through the injected immutable library", () => {
    expect(Object.isFrozen(nativeWorkspaceNodeLibrary)).toBe(true);
    const emptyLibrary: WorkspaceNodeLibrary = Object.freeze({
      catalog: nativeWorkspaceNodeLibrary.catalog,
      getSpec: (): undefined => {},
      getDescriptor: (): undefined => {},
    });
    const workspace = createWorkspace(emptyLibrary);
    expect(() => workspace.addNode("obs", { x: 0, y: 0 })).toThrow('no registered node descriptor for type "obs"');
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
      if ((workspace.store.state.nodes[dataset]?.config as { datasetKey?: string })?.datasetKey === "donor-a") {
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
    const cache = workspace.addNode("cache", { x: 0, y: 0 }, "reused-cache");

    workspace.frozenPredicates.set(cache, "row_id > 10");
    workspace.frozenRows.set(cache, [rowIndex(11), rowIndex(12)]);

    workspace.removeNode(cache);
    workspace.addNode("cache", { x: 0, y: 0 }, cache);

    expect(workspace.frozenPredicates.has(cache)).toBe(false);
    expect(workspace.frozenRows.has(cache)).toBe(false);
    workspace.dispose();
  });

  test("publishes a connection only after its evaluator projection is live", () => {
    const workspace = createWorkspace();
    const collection = workspace.addNode("collection", { x: 0, y: 0 });
    const count = workspace.addNode("count", { x: 100, y: 0 });
    workspace.updateNodeConfig(collection, {
      collectionId: "keepers",
      collectionName: "Keepers",
      collectionVersion: 3,
    });

    let predicateSeenByDocumentSubscriber: string | null | undefined;
    const subscription = workspace.store.subscribe(() => {
      if (Object.keys(workspace.store.state.edges).length === 1) {
        predicateSeenByDocumentSubscriber = predicateSql(workspace.pullGraphNode(count));
      }
    });

    expect(workspace.connect(collection, count)).toBe(true);
    expect(predicateSeenByDocumentSubscriber).toContain("collection_id = 'keepers'");
    subscription.unsubscribe();
    workspace.dispose();
  });

  test("publishes an edge deletion only after evaluator disconnection", () => {
    const workspace = createWorkspace();
    const collection = workspace.addNode("collection", { x: 0, y: 0 });
    const count = workspace.addNode("count", { x: 100, y: 0 });
    workspace.updateNodeConfig(collection, {
      collectionId: "keepers",
      collectionName: "Keepers",
      collectionVersion: 1,
    });
    expect(workspace.connect(collection, count)).toBe(true);
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
    const collection = source.addNode("collection", { x: 0, y: 0 });
    const count = source.addNode("count", { x: 100, y: 0 });
    source.updateNodeConfig(collection, {
      collectionId: "keepers",
      collectionName: "Keepers",
      collectionVersion: 2,
    });
    expect(source.connect(collection, count)).toBe(true);

    const destination = createWorkspace();
    let notifications = 0;
    let hydratedPredicate: string | null | undefined;
    const subscription = destination.store.subscribe(() => {
      notifications += 1;
      hydratedPredicate = predicateSql(destination.pullGraphNode(count));
    });

    destination.loadDocument(source.store.state);
    expect(notifications).toBe(1);
    expect(hydratedPredicate).toContain("collection_id = 'keepers'");
    subscription.unsubscribe();
    source.dispose();
    destination.dispose();
  });
});
