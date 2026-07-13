import { beforeEach, describe, expect, test } from "bun:test";
import type { Metadata } from "@ndea/protocol";
import { predicateSql } from "@/core/graph/cook";
import { registerBuiltinNodes } from "./nodes";
import { Workspace } from "./workspace-store";

function createWorkspace(): Workspace {
  return new Workspace({
    coordinator: { query: () => Promise.resolve([]) } as never,
    table: "atlas",
    metadata: { dataset_keys: [] } as unknown as Metadata,
  });
}

beforeEach(() => {
  globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
    callback(0);
    return 0;
  }) as typeof requestAnimationFrame;
  registerBuiltinNodes();
});

describe("Workspace graph transactions", () => {
  test("publishes a dataset config only after synchronous sinks recook it", () => {
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

    workspace.setDatasetKey(dataset, "donor-a");

    expect(sinkPredicate).toBe("_dataset = 'donor-a'");
    expect(subscriberPredicate).toBe("_dataset = 'donor-a'");
    subscription.unsubscribe();
    unregister();
    workspace.dispose();
  });

  test("removing nodes clears every per-node runtime projection before ID reuse", () => {
    const workspace = createWorkspace();
    const cache = workspace.addNode("cache", { x: 0, y: 0 }, "reused-cache");
    const collection = workspace.addNode("collection", { x: 100, y: 0 }, "reused-collection");
    const transform = workspace.addNode("threshold", { x: 200, y: 0 }, "reused-transform");
    const wrangle = workspace.addNode("wrangle", { x: 300, y: 0 }, "reused-wrangle");

    workspace.frozenPredicates.set(cache, "row_id > 10");
    workspace.frozenRows.set(cache, [11, 12]);
    workspace.bindCollection(collection, { id: "keepers", name: "Keepers", version: 1 });
    workspace.setWranglePred(wrangle, "score > 0.5");
    expect(workspace.transformHosts.has(transform)).toBe(true);

    workspace.removeNode(cache);
    workspace.removeNode(collection);
    workspace.removeNode(transform);
    workspace.removeNode(wrangle);
    workspace.addNode("cache", { x: 0, y: 0 }, cache);
    workspace.addNode("collection", { x: 100, y: 0 }, collection);
    workspace.addNode("wrangle", { x: 300, y: 0 }, wrangle);

    expect(workspace.frozenPredicates.has(cache)).toBe(false);
    expect(workspace.frozenRows.has(cache)).toBe(false);
    expect(workspace.collectionBindings.has(collection)).toBe(false);
    expect(workspace.transformHosts.has(transform)).toBe(false);
    expect(workspace.wranglePreds.has(wrangle)).toBe(false);
    workspace.dispose();
  });

  test("publishes a connection only after its evaluator projection is live", () => {
    const workspace = createWorkspace();
    const collection = workspace.addNode("collection", { x: 0, y: 0 });
    const count = workspace.addNode("count", { x: 100, y: 0 });
    workspace.bindCollection(collection, { id: "keepers", name: "Keepers", version: 3 });

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
    workspace.bindCollection(collection, { id: "keepers", name: "Keepers", version: 1 });
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
    source.bindCollection(collection, { id: "keepers", name: "Keepers", version: 2 });
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
