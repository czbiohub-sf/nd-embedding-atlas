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
} from "@ndea/sdk";
import { z } from "zod";

import type { GraphPortValue } from "@ndea/graph";
import type { AppNodeLibrary, AppNodeSpec } from "@/core/node/library";
import type { GraphDocumentNode } from "@/core/graph/records";
import type { AppNodeHostDependencies } from "./host";
import type { NodeRuntimeSessionPort } from "./session-port";
import { predicateToSql } from "@/lib/mosaic-helpers";
import { WorkspaceNodeRuntimeManager } from "./workspace-runtime";
import {
  coordinationDocumentPort,
  createCoordination,
  type CoordinationDocumentState,
} from "@/core/coordination/coordination";

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

function appHostDependencies(): AppNodeHostDependencies {
  const coordinator = {
    connect() {},
    disconnect() {},
    query: () => Promise.resolve([]),
  } as unknown as AppNodeHostDependencies["coordinator"];
  const fetch = (() => Promise.resolve(new Response(null, { status: 204 }))) as unknown as typeof globalThis.fetch;
  return {
    coordinator,
    defaultInputPredicate: {} as AppNodeHostDependencies["defaultInputPredicate"],
    table: "dataset",
    metadata: {} as AppNodeHostDependencies["metadata"],
    refreshMetadata: () => Promise.resolve(),
    availableCapabilities: new Set<NodeCapability>([
      "data-read",
      "focus-coordination",
      "ordering-coordination",
      "filter-coordination",
    ]),
    deviceBroker: {
      acquire: () => Promise.reject(new Error("unexpected device acquire")),
      releaseFor() {},
    },
    fetch,
  };
}

interface WorkspaceFixture {
  readonly session: NodeRuntimeSessionPort;
  readonly documentStore: Store<{
    nodes: Record<string, GraphDocumentNode>;
    flags: Record<string, { bypass?: boolean; off?: boolean }>;
  }>;
  readonly coordinationStore: Store<CoordinationDocumentState>;
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
  const coordinationStore = new Store<CoordinationDocumentState>({ state: {}, bindings: {} });
  let graphListener: ((value: GraphPortValue) => void) | null = null;
  const session = {
    store: documentStore,
    coordination: createCoordination(coordinationDocumentPort(coordinationStore)),
    registerGraphSink(_nodeId: string, listener: (value: GraphPortValue) => void) {
      graphListener = listener;
      return () => {
        graphListener = null;
      };
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
                ...(state.nodes[nodeId].config?.value as Record<string, JsonValue>),
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
    coordinationStore,
    deliverGraph(value) {
      if (!graphListener) throw new Error("graph sink is not registered");
      graphListener(value);
    },
  };
}

function nodeLibrary(definition: AppNodeSpec["definition"], overrides: Partial<AppNodeSpec> = {}): AppNodeLibrary {
  const spec = { definition, role: "view", ...overrides } as unknown as AppNodeSpec;
  return {
    catalog: { resolveExact: () => definition } as unknown as AppNodeLibrary["catalog"],
    getSpecExact: () => spec,
  } as unknown as AppNodeLibrary;
}

function bodyDefinition<C extends NodeCapability>(
  capabilities: readonly C[],
  mounted: { host?: NodeHost<unknown, C> },
  title = "Runtime fixture",
) {
  return defineNode({
    ref: exactNodeTypeRef("runtime-fixture", "1.0.0"),
    title,
    role: "view",
    inputs: [],
    outputs: [],
    capabilities,
    load: () =>
      Promise.resolve({
        mountBody(host) {
          mounted.host = host;
          return { element: new FixtureElement() as unknown as HTMLElement, dispose() {} };
        },
      } satisfies NodeModule<unknown, C>),
  });
}

describe("WorkspaceNodeRuntimeManager", () => {
  test("a missing required app facet fails before Body mount", async () => {
    let mounts = 0;
    const definition = defineNode({
      ref: exactNodeTypeRef("runtime-fixture", "1.0.0"),
      title: "Missing app facet",
      role: "view",
      inputs: [],
      outputs: [],
      capabilities: [] as const,
      load: () =>
        Promise.resolve({
          mountBody() {
            mounts += 1;
            return { element: new FixtureElement() as unknown as HTMLElement, dispose() {} };
          },
        } satisfies NodeModule),
    });
    const fixture = workspaceFixture();
    const manager = new WorkspaceNodeRuntimeManager({
      session: fixture.session,
      nodeLibrary: nodeLibrary(definition, { requiredHostFacets: ["hierarchy"] }),
      appHost: appHostDependencies(),
    });

    const runtime = manager.activate("node-1", definition.ref);
    await runtime.start();

    expect(runtime.getSnapshot()).toMatchObject({ status: "failed", stage: "capability" });
    expect(mounts).toBe(0);
    manager.dispose();
  });

  test("resolves required body header before Body mount", async () => {
    const mounted: { host?: NodeHost } = {};
    const definition = bodyDefinition([], mounted, "Body header");
    const fixture = workspaceFixture();
    const manager = new WorkspaceNodeRuntimeManager({
      session: fixture.session,
      nodeLibrary: nodeLibrary(definition, { requiredHostFacets: ["bodyHeaderElement"] }),
      appHost: appHostDependencies(),
    });

    await manager.activate("node-1", definition.ref).start();

    expect(mounted.host).toBeDefined();
    manager.dispose();
  });

  test("host.filter keeps one selection, writes clauses into the document, and leaves scopes cleanly", async () => {
    const mounted: { host?: NodeHost<unknown, "filter-coordination"> } = {};
    const definition = bodyDefinition(["filter-coordination"] as const, mounted);
    const fixture = workspaceFixture();
    const manager = new WorkspaceNodeRuntimeManager({
      session: fixture.session,
      nodeLibrary: nodeLibrary(definition),
      appHost: appHostDependencies(),
    });
    await manager.activate("node-1", definition.ref).start();
    if (!mounted.host) throw new Error("Body did not receive a host");
    const stable = mounted.host.filter.selection;

    fixture.deliverGraph({ kind: "pred", sql: "quality > 0.5" });
    expect(mounted.host.filter.getResolved().predicate).toBe("quality > 0.5");
    fixture.documentStore.setState((state) => ({
      ...state,
      flags: { ...state.flags, "node-1": { off: true } },
    }));
    expect(mounted.host.filter.getResolved().predicate).toBeNull();
    fixture.documentStore.setState((state) => ({ ...state, flags: {} }));
    fixture.session.coordination.assignScope("node-1", "filter", "A");
    mounted.host.filter.publish("chart", { op: "gt", column: "x", value: 1 });
    expect(fixture.coordinationStore.state.state.filter?.A).toEqual({
      "node-1": { chart: { op: "gt", column: "x", value: 1 } },
    });
    fixture.session.coordination.assignScope("node-1", "filter", "B");
    expect(mounted.host.filter.selection).toBe(stable);
    expect(fixture.coordinationStore.state.state.filter?.A).toEqual({});

    manager.dispose();
  });

  test("composes config, predicate, focus, and ordering facets without a Proxy", async () => {
    const mounted: {
      host?: NodeHost<unknown, "data-read" | "focus-coordination" | "ordering-coordination">;
    } = {};
    const element = new FixtureElement();
    const definition = defineNode({
      ref: exactNodeTypeRef("runtime-fixture", "1.0.0"),
      title: "Runtime fixture",
      role: "view",
      inputs: [],
      outputs: [],
      capabilities: ["data-read", "focus-coordination", "ordering-coordination"] as const,
      config: {
        schema: z.object({ page: z.number(), lanes: z.number() }),
        version: nodeConfigVersion(1),
        defaultValue: { page: 1, lanes: 3 },
      },
      load: () =>
        Promise.resolve({
          mountBody(host) {
            mounted.host = host;
            return { element: element as unknown as HTMLElement, dispose: () => element.remove() };
          },
        } satisfies NodeModule<unknown, "data-read" | "focus-coordination" | "ordering-coordination">),
    });
    const fixture = workspaceFixture();
    const manager = new WorkspaceNodeRuntimeManager({
      session: fixture.session,
      nodeLibrary: nodeLibrary(definition),
      appHost: appHostDependencies(),
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

    fixture.deliverGraph({ kind: "pred", sql: "x > 3" });
    expect(predicateToSql(host.inputPredicate)).toBe("x > 3");
    fixture.deliverGraph({ kind: "pred", sql: null });
    expect(predicateToSql(host.inputPredicate)).toBeNull();

    host.focus.set(rowIndex(12));
    expect(host.focus.get()).toBe(rowIndex(12));
    fixture.session.coordination.assignScope("node-1", "focus", "A");
    fixture.session.coordination.setCoordinationValue("focus", "A", rowIndex(21));
    expect(host.focus.get()).toBe(rowIndex(21));
    expect(fixture.coordinationStore.state.bindings["node-1"]?.focus).toEqual({ $bindState: "/focus/A" });
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
        } satisfies NodeModule),
    });
    const fixture = workspaceFixture();
    const manager = new WorkspaceNodeRuntimeManager({
      session: fixture.session,
      nodeLibrary: nodeLibrary(definition),
      appHost: appHostDependencies(),
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
