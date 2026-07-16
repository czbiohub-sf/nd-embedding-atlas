import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Store } from "@tanstack/store";
import {
  defineNode,
  exactNodeTypeRef,
  nodeConfigVersion,
  rowIndex,
  type JsonValue,
  type NodeCapability,
  type NodeHost,
  type NodeModule,
  type RowIndex,
} from "@ndea/sdk";
import { z } from "zod";

import type { GraphPortValue } from "@/core/graph/values";
import type { AppNodeLibrary, AppNodeSpec } from "@/core/node/library";
import type { GraphDocumentNode } from "@/core/graph/records";
import type { AppNodeHostDependencies } from "./host";
import type { NodeRuntimeSessionPort } from "./session-port";
import { WorkspaceNodeRuntimeManager } from "./workspace-runtime";

class FixtureElement {
  readonly children: FixtureElement[] = [];
  readonly style = { cssText: "" };
  className = "";
  parent: FixtureElement | null = null;
  removeCalls = 0;

  appendChild(child: FixtureElement): FixtureElement {
    if (child.parent) child.parent.children.splice(child.parent.children.indexOf(child), 1);
    child.parent = this;
    this.children.push(child);
    return child;
  }

  remove(): void {
    this.removeCalls += 1;
    if (!this.parent) return;
    this.parent.children.splice(this.parent.children.indexOf(this), 1);
    this.parent = null;
  }
}

const originalDocument = globalThis.document;

beforeAll(() => {
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { createElement: () => new FixtureElement() },
  });
});

afterAll(() => {
  Object.defineProperty(globalThis, "document", { configurable: true, value: originalDocument });
});

function appHostDependencies(predicateCalls: { facet: string; sql: string | null }[]): AppNodeHostDependencies {
  return {
    coordinator: {
      connect() {},
      disconnect() {},
      query: () => Promise.resolve([]),
    } as unknown as AppNodeHostDependencies["coordinator"],
    defaultInputPredicate: {} as AppNodeHostDependencies["defaultInputPredicate"],
    table: "dataset",
    metadata: {} as AppNodeHostDependencies["metadata"],
    refreshMetadata: () => Promise.resolve(),
    availableCapabilities: new Set<NodeCapability>([
      "data-read",
      "predicate-publish",
      "row-set-subscribe",
      "focus-coordination",
      "ordering-coordination",
    ]),
    predicateBus: {
      publishPredicate: (_instanceId, facet, sql) => predicateCalls.push({ facet, sql }),
      makeToken: (table, count) => ({ predicate: table, table, count, token: 1 }),
      disposeInstance() {},
    },
    rowSetBus: {
      publishRowSet() {},
      clear() {},
      disposeFor() {},
    },
    deviceBroker: {
      acquire: () => Promise.reject(new Error("unexpected device acquire")),
      releaseFor() {},
    },
    fetch: (() => Promise.resolve(new Response(null, { status: 204 }))) as unknown as typeof globalThis.fetch,
  };
}

interface WorkspaceFixture {
  readonly session: NodeRuntimeSessionPort;
  readonly documentStore: Store<{
    nodes: Record<string, GraphDocumentNode>;
    flags: Record<string, { bypass?: boolean; off?: boolean }>;
  }>;
  readonly emitLassoCalls: { sql: string | null; rowIds: readonly RowIndex[] | null }[];
  readonly emitFocusCalls: (RowIndex | null)[];
  deliverGraph(value: GraphPortValue): void;
}

function workspaceFixture(): WorkspaceFixture {
  const documentStore = new Store<{
    nodes: Record<string, GraphDocumentNode>;
    flags: Record<string, { bypass?: boolean; off?: boolean }>;
  }>({
    nodes: {
      "node-1": {
        id: "node-1",
        definitionRef: exactNodeTypeRef("runtime-fixture", "1.0.0"),
        label: "Runtime fixture",
        config: { version: nodeConfigVersion(1), value: { page: 4 } },
      },
    },
    flags: {},
  });
  const emitLassoCalls: { sql: string | null; rowIds: readonly RowIndex[] | null }[] = [];
  const emitFocusCalls: (RowIndex | null)[] = [];
  let graphListener: ((value: GraphPortValue) => void) | null = null;
  const scopes = new Map<string, string>();
  const cells = new Map<string, unknown>();
  const coordinationListeners = new Set<(value: unknown) => void>();
  const session = {
    store: documentStore,
    coordination: {
      scopeOf(nodeId: string, type: string) {
        return scopes.get(`${nodeId}:${type}`);
      },
      readCoordination(type: string, scope: string) {
        return cells.get(`${type}:${scope}`);
      },
      setCoordinationValue(type: string, scope: string, value: unknown) {
        cells.set(`${type}:${scope}`, value);
        for (const listener of coordinationListeners) listener(value);
      },
      assignScope(nodeId: string, type: string, scope: string) {
        scopes.set(`${nodeId}:${type}`, scope);
      },
      clearScope(nodeId: string, type: string) {
        scopes.delete(`${nodeId}:${type}`);
      },
      subscribe(_nodeId: string, _type: string, listener: (value: unknown) => void) {
        const wrapped = (value: unknown) => listener(value);
        coordinationListeners.add(wrapped);
        return () => coordinationListeners.delete(wrapped);
      },
    },
    registerGraphSink(_nodeId: string, listener: (value: GraphPortValue) => void) {
      graphListener = listener;
      return () => {
        graphListener = null;
      };
    },
    emitLasso(_nodeId: string, sql: string | null, rowIds: readonly RowIndex[] | null = null) {
      emitLassoCalls.push({ sql, rowIds });
    },
    getLasso() {
      const last = emitLassoCalls.at(-1);
      return last ? { kind: "sel" as const, ...last } : undefined;
    },
    emitFocus(_nodeId: string, value: RowIndex | null) {
      emitFocusCalls.push(value);
    },
    updateNodeConfig(nodeId: string, patch: Record<string, unknown>) {
      documentStore.setState((state) => ({
        ...state,
        nodes: {
          ...state.nodes,
          [nodeId]: {
            ...state.nodes[nodeId],
            config: {
              version: nodeConfigVersion(1),
              value: {
                ...(state.nodes[nodeId].config?.value as Record<string, JsonValue> | undefined),
                ...(patch as Record<string, JsonValue>),
              },
            },
          },
        },
      }));
    },
  } as unknown as NodeRuntimeSessionPort;

  return {
    session,
    documentStore,
    emitLassoCalls,
    emitFocusCalls,
    deliverGraph(value) {
      if (!graphListener) throw new Error("graph sink is not registered");
      graphListener(value);
    },
  };
}

function nodeLibrary(definition: AppNodeSpec["definition"]): AppNodeLibrary {
  const spec = { definition, role: "view" } as unknown as AppNodeSpec;
  return {
    catalog: { resolveExact: () => definition } as unknown as AppNodeLibrary["catalog"],
    getSpecExact: () => spec,
  } as unknown as AppNodeLibrary;
}

describe("WorkspaceNodeRuntimeManager", () => {
  test("composes config, edge row-set, predicate, focus, and ordering facets without a Proxy", async () => {
    const mounted: { host?: NodeHost } = {};
    const element = new FixtureElement();
    const definition = defineNode({
      ref: exactNodeTypeRef("runtime-fixture", "1.0.0"),
      title: "Runtime fixture",
      role: "view",
      inputs: [],
      outputs: [],
      capabilities: [
        "data-read",
        "predicate-publish",
        "row-set-subscribe",
        "focus-coordination",
        "ordering-coordination",
      ] as const,
      config: {
        schema: z.object({ page: z.number(), lanes: z.number() }),
        version: nodeConfigVersion(1),
        defaultValue: { page: 1, lanes: 3 },
      },
      load: () =>
        Promise.resolve({
          mountBody(host) {
            mounted.host = host as unknown as NodeHost;
            return { element: element as unknown as HTMLElement, dispose: () => element.remove() };
          },
        } satisfies NodeModule<
          unknown,
          "data-read" | "predicate-publish" | "row-set-subscribe" | "focus-coordination" | "ordering-coordination"
        >),
    });
    const fixture = workspaceFixture();
    const predicateCalls: { facet: string; sql: string | null }[] = [];
    const manager = new WorkspaceNodeRuntimeManager({
      session: fixture.session,
      nodeLibrary: nodeLibrary(definition),
      appHost: appHostDependencies(predicateCalls),
    });

    const runtime = manager.activate("node-1", definition.ref);
    await runtime.start();
    if (!mounted.host) throw new Error("Body did not receive a host");
    const host = mounted.host;
    expect(host.config).toEqual({ page: 4, lanes: 3 });
    host.patchConfig({ page: 9 });
    expect(fixture.documentStore.state.nodes["node-1"].config).toEqual({
      version: nodeConfigVersion(1),
      value: { page: 9 },
    });

    fixture.deliverGraph({ kind: "sel", sql: "x > 2", rowIds: [] });
    expect(host.externalRowSet()).toEqual([]);
    fixture.deliverGraph({ kind: "pred", sql: "x > 3" });
    expect(host.externalRowSet()).toBeNull();

    host.publishPredicate("lasso", "x < 4");
    host.publishPredicate("range", "y > 8");
    expect(fixture.emitLassoCalls.at(-1)).toEqual({ sql: "x < 4", rowIds: null });
    expect(predicateCalls).toEqual([{ facet: "range", sql: "y > 8" }]);

    host.focus.set(rowIndex(12));
    expect(host.focus.get()).toBe(rowIndex(12));
    expect(fixture.emitFocusCalls).toEqual([rowIndex(12)]);
    fixture.deliverGraph({ kind: "focus", rowIndex: rowIndex(21) });
    expect(host.focus.get()).toBe(rowIndex(21));
    expect(host.ordering.get()).toBeNull();

    manager.dispose();
  });

  test("node removal disposes its Body before host and page teardown unwinds remaining instances once", async () => {
    const events: string[] = [];
    const definition = defineNode({
      ref: exactNodeTypeRef("runtime-fixture", "1.0.0"),
      title: "Runtime fixture",
      role: "view",
      inputs: [],
      outputs: [],
      capabilities: [],
      load: () =>
        Promise.resolve({
          createRuntime: (host) => {
            host.onDispose(() => {
              events.push("host");
            });
            return {
              dispose: () => {
                events.push("runtime");
              },
            };
          },
          mountBody: () => ({
            element: new FixtureElement() as unknown as HTMLElement,
            dispose: () => {
              events.push("body");
            },
          }),
        } satisfies NodeModule<unknown, never>),
    });
    const fixture = workspaceFixture();
    const dependencies = appHostDependencies([]);
    const manager = new WorkspaceNodeRuntimeManager({
      session: fixture.session,
      nodeLibrary: nodeLibrary(definition),
      appHost: dependencies,
    });
    const runtime = manager.activate("node-1", definition.ref);
    await runtime.start();
    runtime.getSnapshot();

    fixture.documentStore.setState((state) => ({ ...state, nodes: {} }));
    expect(manager.get("node-1")).toBeUndefined();
    expect(events).toEqual(["body", "runtime", "host"]);

    fixture.documentStore.setState((state) => ({
      ...state,
      nodes: {
        "node-2": {
          id: "node-2",
          definitionRef: exactNodeTypeRef("runtime-fixture", "1.0.0"),
          label: "Second runtime fixture",
        },
      },
    }));
    const secondRuntime = manager.activate("node-2", definition.ref);
    await secondRuntime.start();
    manager.dispose();
    manager.dispose();
    expect(events).toEqual(["body", "runtime", "host", "body", "runtime", "host"]);
  });
});
