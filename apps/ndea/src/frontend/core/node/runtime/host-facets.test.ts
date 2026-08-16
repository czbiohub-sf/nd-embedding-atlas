import { describe, expect, test } from "bun:test";
import { Store } from "@tanstack/store";
import { exactNodeTypeRef, rowIndex, type FilterCoordinationAPI } from "@ndea/sdk";
import {
  createCheckpointCreationNodeFacet,
  createCheckpointNodeFacet,
  createHierarchyNodeFacet,
} from "@/core/node/runtime/host-facets";
import { requireAppNodeHostFacet } from "@/core/node/app-node-host";
import type { NodeRuntimeSessionPort } from "@/core/node/runtime/session-port";

function runtimeSessionFixture() {
  const store = new Store({
    nodes: {
      cache: {
        id: "cache",
        definitionRef: exactNodeTypeRef("cache", "1.0.0"),
        label: "Cache",
        stamp: undefined as number | undefined,
      },
      subnet: { id: "subnet", definitionRef: exactNodeTypeRef("subnet", "1.0.0"), label: "Subnet" },
      child: {
        id: "child",
        definitionRef: exactNodeTypeRef("count", "1.0.0"),
        label: "Count",
        parent: "subnet",
      },
      seam: {
        id: "seam",
        definitionRef: exactNodeTypeRef("proxy", "1.0.0"),
        label: "Proxy",
        parent: "subnet",
      },
    },
    flags: {},
  });
  const telemetry = new Store({ epoch: 3 });
  const checkpointStatus = new Store<
    Readonly<Record<string, { readonly pending: boolean; readonly error: string | null }>>
  >({ cache: { pending: false, error: null } });
  let pinned = false;
  let input:
    | { kind: "sel"; sql: string | null; rowIds: number[] | null }
    | { kind: "pred"; sql: string | null }
    | null = { kind: "sel", sql: "id IN (2, 5)", rowIds: [2, 5] };
  const calls = { pin: 0, unpin: 0, create: 0, enter: 0 };
  const session = {
    store,
    telemetry,
    checkpointStatus,
    liveCacheInput: () => input,
    isCached: () => pinned,
    setCheckpointStatus: (nodeId: string, status: { readonly pending: boolean; readonly error: string | null }) => {
      checkpointStatus.setState((state) => ({ ...state, [nodeId]: status }));
    },
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
  } as unknown as NodeRuntimeSessionPort;
  const selection: FilterCoordinationAPI["selection"] = {} as FilterCoordinationAPI["selection"];
  const filter = {
    selection,
    getResolved: () => ({ predicate: "id IN (2, 5)", revision: 1 }),
    subscribeResolved: () => () => {},
    publish() {},
    clear() {},
    associateClient() {},
    disassociateClient() {},
    materializeRowIds: async () => ({ rowIds: [rowIndex(2), rowIndex(5)], revision: 1 }),
  } satisfies FilterCoordinationAPI;
  return {
    session,
    store,
    telemetry,
    checkpointStatus,
    filter,
    calls,
    setInput(next: typeof input) {
      input = next;
    },
  };
}

describe("app-local node host facets", () => {
  test("required facet resolver proves each closed app-only structure", () => {
    const host = {
      checkpoint: {
        getSnapshot() {},
        subscribe() {},
        async pin() {
          return true;
        },
        unpin() {},
      },
      checkpointCreation: { create() {} },
      hierarchy: { getSnapshot() {}, subscribe() {}, enter() {} },
      bodyHeaderElement: { appendChild() {} },
    };

    expect(Object.is(requireAppNodeHostFacet(host, "checkpoint"), host.checkpoint)).toBe(true);
    expect(Object.is(requireAppNodeHostFacet(host, "checkpointCreation"), host.checkpointCreation)).toBe(true);
    expect(Object.is(requireAppNodeHostFacet(host, "hierarchy"), host.hierarchy)).toBe(true);
    expect(Object.is(requireAppNodeHostFacet(host, "bodyHeaderElement"), host.bodyHeaderElement)).toBe(true);
    for (const facet of ["checkpoint", "checkpointCreation", "hierarchy", "bodyHeaderElement"] as const) {
      expect(() => requireAppNodeHostFacet({}, facet)).toThrow(`app node host requires facet "${facet}"`);
    }
  });

  test("checkpoint exposes stable input/pin snapshots and only narrow actions", async () => {
    const fixture = runtimeSessionFixture();
    const checkpoint = createCheckpointNodeFacet(fixture.session, "cache", fixture.filter);

    const initial = checkpoint.getSnapshot();
    expect(initial).toEqual({
      epoch: 3,
      pinned: false,
      pinnedEpoch: null,
      input: { kind: "row-set", predicate: "id IN (2, 5)", rowCount: 2 },
      pending: false,
      error: null,
    });
    expect(checkpoint.getSnapshot()).toBe(initial);
    expect(Object.keys(checkpoint).toSorted()).toEqual(["getSnapshot", "pin", "subscribe", "unpin"]);

    expect(await checkpoint.pin()).toBe(true);
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
      pending: false,
      error: null,
    });

    checkpoint.unpin();
    expect(fixture.calls.unpin).toBe(1);
  });

  test("facet subscriptions disconnect from every backing state source", () => {
    const fixture = runtimeSessionFixture();
    const checkpoint = createCheckpointNodeFacet(fixture.session, "cache", fixture.filter);
    let changes = 0;
    const unsubscribe = checkpoint.subscribe(() => {
      changes += 1;
    });
    fixture.telemetry.setState(() => ({ epoch: 4 }));
    fixture.store.setState((state) => ({ ...state }));
    fixture.checkpointStatus.setState(() => ({ cache: { pending: true, error: null } }));
    expect(changes).toBe(3);

    unsubscribe();
    fixture.telemetry.setState(() => ({ epoch: 5 }));
    fixture.store.setState((state) => ({ ...state }));
    fixture.checkpointStatus.setState(() => ({ cache: { pending: false, error: "failed" } }));
    expect(changes).toBe(3);
  });

  test("unpin invalidates a pending materialization", async () => {
    const fixture = runtimeSessionFixture();
    const deferred = Promise.withResolvers<{ rowIds: ReturnType<typeof rowIndex>[]; revision: number }>();
    const filter = {
      ...fixture.filter,
      materializeRowIds: () => deferred.promise,
    } satisfies FilterCoordinationAPI;
    const checkpoint = createCheckpointNodeFacet(fixture.session, "cache", filter);

    const pending = checkpoint.pin();
    checkpoint.unpin();
    deferred.resolve({ rowIds: [rowIndex(9)], revision: 1 });

    expect(await pending).toBe(false);
    expect(fixture.calls.pin).toBe(0);
    expect(fixture.calls.unpin).toBe(1);
  });

  test("abort cannot resurrect removed checkpoint status", async () => {
    const fixture = runtimeSessionFixture();
    const controller = new AbortController();
    const deferred = Promise.withResolvers<{ rowIds: ReturnType<typeof rowIndex>[]; revision: number }>();
    const filter = {
      ...fixture.filter,
      materializeRowIds: () => deferred.promise,
    } satisfies FilterCoordinationAPI;
    const checkpoint = createCheckpointNodeFacet(fixture.session, "cache", filter, controller.signal);

    const pending = checkpoint.pin();
    controller.abort();
    fixture.checkpointStatus.setState(() => ({}));
    deferred.resolve({ rowIds: [rowIndex(9)], revision: 1 });

    expect(await pending).toBe(false);
    expect(fixture.checkpointStatus.state.cache).toBeUndefined();
    expect(fixture.calls.pin).toBe(0);
  });

  test("checkpoint creation and hierarchy expose no Workspace-shaped command bag", () => {
    const fixture = runtimeSessionFixture();
    const creation = createCheckpointCreationNodeFacet(fixture.session, "scatter");
    const hierarchy = createHierarchyNodeFacet(fixture.session, "subnet");

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
        second: {
          id: "second",
          definitionRef: exactNodeTypeRef("count", "1.0.0"),
          label: "Count",
          parent: "subnet",
        },
      },
    }));
    expect(hierarchy.getSnapshot()).toEqual({ childCount: 2 });
  });
});
