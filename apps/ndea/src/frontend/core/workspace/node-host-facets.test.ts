import { describe, expect, test } from "bun:test";
import { Store } from "@tanstack/store";
import { rowIndex } from "@ndea/sdk";
import {
  createCheckpointCreationNodeFacet,
  createCheckpointNodeFacet,
  createEdgeInputRowSetBinding,
  createHierarchyNodeFacet,
  deliverEdgeInputRowSet,
} from "./node-host-facets";
import type { Workspace } from "./workspace-store";

function workspaceFixture() {
  const store = new Store({
    nodes: {
      cache: { id: "cache", type: "cache", stamp: undefined as number | undefined },
      subnet: { id: "subnet", type: "subnet" },
      child: { id: "child", type: "count", parent: "subnet" },
      seam: { id: "seam", type: "proxy", parent: "subnet" },
    },
  });
  const telemetry = new Store({ epoch: 3 });
  let pinned = false;
  let input:
    | { kind: "sel"; sql: string | null; rowIds: number[] | null }
    | { kind: "pred"; sql: string | null }
    | null = { kind: "sel", sql: "id IN (2, 5)", rowIds: [2, 5] };
  const calls = { pin: 0, unpin: 0, create: 0, enter: 0 };
  const workspace = {
    store,
    telemetry,
    liveCacheInput: () => input,
    isCached: () => pinned,
    pinCache: () => {
      calls.pin += 1;
      pinned = true;
      return true;
    },
    uncache: () => {
      calls.unpin += 1;
      pinned = false;
    },
    freezeSelection: () => {
      calls.create += 1;
      return "created-cache";
    },
    enterSubnet: () => {
      calls.enter += 1;
    },
  } as unknown as Workspace;
  return {
    workspace,
    store,
    telemetry,
    calls,
    setInput(next: typeof input) {
      input = next;
    },
  };
}

describe("app-local node host facets", () => {
  test("edge input row sets replace, clear, and disconnect independently", () => {
    const binding = createEdgeInputRowSetBinding();
    const seen: (readonly number[] | null)[] = [];
    const unsubscribe = binding.onExternalRowSet((rowIndices) => seen.push(rowIndices));

    expect(binding.externalRowSet()).toBeNull();
    deliverEdgeInputRowSet(binding, {
      kind: "sel",
      sql: "__row_index__ IN (2, 5)",
      rowIds: [rowIndex(2), rowIndex(5)],
    });
    deliverEdgeInputRowSet(binding, { kind: "sel", sql: "__row_index__ = 8", rowIds: [rowIndex(8)] });
    deliverEdgeInputRowSet(binding, { kind: "sel", sql: null, rowIds: [] });
    deliverEdgeInputRowSet(binding, { kind: "pred", sql: "quality > 0.5" });
    expect(seen).toEqual([[rowIndex(2), rowIndex(5)], [rowIndex(8)], [], null]);
    expect(binding.externalRowSet()).toBeNull();

    unsubscribe();
    binding.update([rowIndex(13)]);
    expect(seen).toHaveLength(4);
  });

  test("checkpoint exposes stable input/pin snapshots and only narrow actions", () => {
    const fixture = workspaceFixture();
    const checkpoint = createCheckpointNodeFacet(fixture.workspace, "cache");

    const initial = checkpoint.getSnapshot();
    expect(initial).toEqual({
      epoch: 3,
      pinned: false,
      pinnedEpoch: null,
      input: { kind: "row-set", predicate: "id IN (2, 5)", rowCount: 2 },
    });
    expect(checkpoint.getSnapshot()).toBe(initial);
    expect(Object.keys(checkpoint).toSorted()).toEqual(["getSnapshot", "pin", "subscribe", "unpin"]);

    expect(checkpoint.pin()).toBe(true);
    expect(fixture.calls.pin).toBe(1);
    fixture.setInput({ kind: "pred", sql: "quality > 0.5" });
    fixture.telemetry.setState(() => ({ epoch: 4 }));
    fixture.store.setState((state) => ({
      ...state,
      nodes: { ...state.nodes, cache: { ...state.nodes.cache, stamp: 3 } },
    }));
    expect(checkpoint.getSnapshot()).toEqual({
      epoch: 4,
      pinned: true,
      pinnedEpoch: 3,
      input: { kind: "predicate", predicate: "quality > 0.5" },
    });

    checkpoint.unpin();
    expect(fixture.calls.unpin).toBe(1);
  });

  test("facet subscriptions disconnect from every backing state source", () => {
    const fixture = workspaceFixture();
    const checkpoint = createCheckpointNodeFacet(fixture.workspace, "cache");
    let changes = 0;
    const unsubscribe = checkpoint.subscribe(() => {
      changes += 1;
    });
    fixture.telemetry.setState(() => ({ epoch: 4 }));
    fixture.store.setState((state) => ({ ...state }));
    expect(changes).toBe(2);

    unsubscribe();
    fixture.telemetry.setState(() => ({ epoch: 5 }));
    fixture.store.setState((state) => ({ ...state }));
    expect(changes).toBe(2);
  });

  test("checkpoint creation and hierarchy expose no Workspace-shaped command bag", () => {
    const fixture = workspaceFixture();
    const creation = createCheckpointCreationNodeFacet(fixture.workspace, "scatter");
    const hierarchy = createHierarchyNodeFacet(fixture.workspace, "subnet");

    expect(Object.keys(creation)).toEqual(["create"]);
    expect(creation.create()).toBe("created-cache");
    expect(fixture.calls.create).toBe(1);

    const initial = hierarchy.getSnapshot();
    expect(initial).toEqual({ childCount: 1 });
    expect(hierarchy.getSnapshot()).toBe(initial);
    expect(Object.keys(hierarchy).toSorted()).toEqual(["enter", "getSnapshot", "subscribe"]);
    hierarchy.enter();
    expect(fixture.calls.enter).toBe(1);

    fixture.store.setState((state) => ({
      ...state,
      nodes: {
        ...state.nodes,
        second: { id: "second", type: "count", parent: "subnet" },
      },
    }));
    expect(hierarchy.getSnapshot()).toEqual({ childCount: 2 });
  });
});
