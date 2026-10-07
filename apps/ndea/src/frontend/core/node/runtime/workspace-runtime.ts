import { Store } from "@tanstack/store";
import { Selection } from "@uwdata/mosaic-core";
import {
  nodeInstanceId,
  type ColorCoordinationAPI,
  type ExactNodeTypeRef,
  type FocusCoordinationAPI,
  type OrderingCoordinationAPI,
  type RowIndex,
  type ViewCoordinationAPI,
} from "@ndea/sdk";

import { stringPredicate } from "@/lib/mosaic-helpers";
import { createFilterBinding } from "@/core/coordination/filter-binding";
import type { CoordinationTypeId, CoordinationValue } from "@/core/coordination/types";
import type { CatalogNodeDefinition } from "@/core/plugin/registration";
import { assertRequiredAppNodeHostFacets } from "@/core/node/app-node-host";
import { createHierarchyNodeFacet } from "./host-facets";
import type { AppNodeLibrary } from "@/core/node/library";
import { createAppNodeHost, type AppNodeHostDependencies, type HostHandle } from "./host";
import { NodeInstanceRuntime } from "./instance-runtime";
import type { NodeRuntimeSessionPort } from "./session-port";

const VIEW_COORDINATION_LOCK = "lock1";

export interface WorkspaceNodeRuntimeManagerDependencies {
  readonly session: NodeRuntimeSessionPort;
  readonly nodeLibrary: AppNodeLibrary;
  readonly appHost: Readonly<AppNodeHostDependencies>;
}

function mergeNodeConfig(definition: CatalogNodeDefinition, nodeConfig: unknown): unknown {
  const defaultConfig = definition.config?.defaultValue;
  if (
    defaultConfig &&
    typeof defaultConfig === "object" &&
    !Array.isArray(defaultConfig) &&
    nodeConfig &&
    typeof nodeConfig === "object" &&
    !Array.isArray(nodeConfig)
  ) {
    return { ...defaultConfig, ...nodeConfig };
  }
  return nodeConfig ?? defaultConfig;
}

/** The node's bound cell of one coordination type; reads `undefined` and drops writes when unbound. */
function boundCell<T extends CoordinationTypeId>(session: NodeRuntimeSessionPort, nodeId: string, type: T) {
  const scope = () => session.coordination.scopeOf(nodeId, type);
  return {
    scope,
    read(): CoordinationValue<T> | undefined {
      const current = scope();
      return current === undefined ? undefined : session.coordination.readCoordination(type, current);
    },
    write(value: CoordinationValue<T>): void {
      const current = scope();
      if (current !== undefined) session.coordination.setCoordinationValue(type, current, value);
    },
    subscribe: (callback: (value: CoordinationValue<T> | undefined) => void) =>
      session.coordination.subscribe(nodeId, type, callback),
  };
}

function createViewCoordination(session: NodeRuntimeSessionPort, nodeId: string): ViewCoordinationAPI {
  const cell = boundCell(session, nodeId, "viewSync");
  return {
    get panX() {
      return cell.read()?.panX ?? 0;
    },
    get panY() {
      return cell.read()?.panY ?? 0;
    },
    get zoom() {
      return cell.read()?.zoom ?? 1;
    },
    get linked() {
      return cell.scope() !== undefined;
    },
    broadcast(state) {
      cell.write({ ...state, src: nodeId });
    },
    toggleLock() {
      if (cell.scope() !== undefined) session.coordination.clearScope(nodeId, "viewSync");
      else session.coordination.assignScope(nodeId, "viewSync", VIEW_COORDINATION_LOCK);
    },
    subscribe(callback) {
      return cell.subscribe((value) => {
        if (value && value.src !== nodeId) callback({ panX: value.panX, panY: value.panY, zoom: value.zoom });
      });
    },
  };
}

function createOrderingCoordination(session: NodeRuntimeSessionPort, nodeId: string): OrderingCoordinationAPI {
  const cell = boundCell(session, nodeId, "ordering");
  return {
    get: () => cell.read() ?? null,
    set: cell.write,
    subscribe: (callback) => cell.subscribe((value) => callback(value ?? null)),
  };
}

function createColorCoordination(session: NodeRuntimeSessionPort, nodeId: string): ColorCoordinationAPI {
  const cell = boundCell(session, nodeId, "colorBy");
  return {
    get linked() {
      return cell.scope() !== undefined;
    },
    get: () => cell.read() ?? null,
    set: cell.write,
    subscribe: (callback) => cell.subscribe((value) => callback(value ?? null)),
  };
}

/** Bound: the scope's shared row. Unbound: this occurrence's own focus. */
function createFocusCoordination(session: NodeRuntimeSessionPort, nodeId: string): FocusCoordinationAPI {
  const cell = boundCell(session, nodeId, "focus");
  const local = new Store<RowIndex | null>(null);
  const read = (): RowIndex | null =>
    cell.scope() === undefined ? local.state : ((cell.read() ?? null) as RowIndex | null);
  return {
    get: read,
    set(rowIndex) {
      if (cell.scope() === undefined) local.setState(() => rowIndex);
      else cell.write(rowIndex);
    },
    subscribe(callback) {
      let previous = read();
      const emitChange = () => {
        const value = read();
        if (value === previous) return;
        previous = value;
        callback(value);
      };
      const localSubscription = local.subscribe(emitChange);
      const cellSubscription = cell.subscribe(emitChange);
      return () => {
        localSubscription.unsubscribe();
        cellSubscription();
      };
    },
  };
}

function createRuntimeHost(
  dependencies: WorkspaceNodeRuntimeManagerDependencies,
  nodeId: string,
  definition: CatalogNodeDefinition,
  headerElement: HTMLElement,
): HostHandle<unknown> {
  const { session, nodeLibrary, appHost } = dependencies;
  const node = session.store.state.nodes[nodeId];
  if (!node) throw new Error(`workspace node not found: ${nodeId}`);
  const spec = nodeLibrary.getSpecExact(node.definitionRef);
  const filterBinding = definition.capabilities.includes("filter-coordination")
    ? createFilterBinding({
        nodeId,
        coordination: session.coordination,
        coordinator: appHost.coordinator,
        table: appHost.table,
      })
    : undefined;
  const inputPredicate = filterBinding?.selection ?? Selection.single();
  const graphSource = { __ndeaGraphNode: nodeId };
  const facets = spec?.role === "subnet" ? { hierarchy: createHierarchyNodeFacet(session, nodeId) } : {};
  assertRequiredAppNodeHostFacets({ ...facets, bodyHeaderElement: headerElement }, spec?.requiredHostFacets ?? []);

  const handle = createAppNodeHost(appHost, {
    instanceId: nodeInstanceId(nodeId),
    definition,
    config: mergeNodeConfig(definition, node.config?.value),
    bodyHeaderElement: headerElement,
    inputPredicate,
    focus: createFocusCoordination(session, nodeId),
    viewCoordination: createViewCoordination(session, nodeId),
    ordering: createOrderingCoordination(session, nodeId),
    colorBy: createColorCoordination(session, nodeId),
    filter: filterBinding,
    facets,
    patchConfig: (patch) => session.updateNodeConfig(nodeId, patch as Record<string, unknown>),
  });

  if (filterBinding) handle.host.track(() => filterBinding.dispose());

  let graphSinkDisposer: (() => void) | null = null;
  const setGraphPredicate = (sql: string | null) => {
    if (filterBinding) {
      filterBinding.setGraphPredicate(sql);
      return;
    }
    inputPredicate.update({
      source: graphSource,
      clients: new Set(),
      fields: [],
      value: sql ? [sql] : null,
      predicate: sql ? stringPredicate(sql) : null,
    });
  };
  const syncGraphSink = () => {
    const off = session.store.state.flags[nodeId]?.off ?? false;
    if (off || !session.store.state.nodes[nodeId]) {
      graphSinkDisposer?.();
      graphSinkDisposer = null;
      setGraphPredicate(null);
      return;
    }
    if (graphSinkDisposer) return;
    graphSinkDisposer = session.registerGraphSink(nodeId, (value) => setGraphPredicate(value.sql));
  };
  const documentSubscription = session.store.subscribe(syncGraphSink);
  handle.host.track(() => documentSubscription.unsubscribe());
  handle.host.track(() => {
    graphSinkDisposer?.();
    graphSinkDisposer = null;
  });
  syncGraphSink();
  return handle;
}

/** Owns every live instance and every stable Body/header adoption element for one Workspace. */
export class WorkspaceNodeRuntimeManager {
  private readonly dependencies: WorkspaceNodeRuntimeManagerDependencies;
  private readonly runtimes = new Map<string, NodeInstanceRuntime>();
  private readonly runtimeRefs = new Map<string, ExactNodeTypeRef>();
  private readonly bodyDocks = new Map<string, HTMLDivElement>();
  private readonly headerDocks = new Map<string, HTMLDivElement>();
  private readonly documentSubscription: { unsubscribe(): void };
  private disposed = false;

  constructor(dependencies: WorkspaceNodeRuntimeManagerDependencies) {
    this.dependencies = dependencies;
    this.documentSubscription = dependencies.session.store.subscribe(() => this.disposeRemovedInstances());
  }

  bodyDock(nodeId: string): HTMLDivElement {
    this.assertLive();
    let element = this.bodyDocks.get(nodeId);
    if (!element) {
      element = document.createElement("div");
      element.className = "nd-body-dock";
      element.style.cssText =
        "display:flex;flex-direction:column;flex:1;min-height:0;min-width:0;height:100%;width:100%;";
      this.bodyDocks.set(nodeId, element);
    }
    return element;
  }

  headerDock(nodeId: string): HTMLDivElement {
    this.assertLive();
    let element = this.headerDocks.get(nodeId);
    if (!element) {
      element = document.createElement("div");
      element.className = "nd-header-dock";
      element.style.cssText =
        "display:flex;align-items:center;flex:1;min-width:0;height:100%;overflow:hidden;container-type:inline-size;line-height:1;";
      this.headerDocks.set(nodeId, element);
    }
    return element;
  }

  activate(nodeId: string, definitionRef: ExactNodeTypeRef): NodeInstanceRuntime {
    this.assertLive();
    const existing = this.runtimes.get(nodeId);
    if (existing) {
      const ref = this.runtimeRefs.get(nodeId)!;
      if (ref.nodeTypeId !== definitionRef.nodeTypeId || ref.nodeTypeVersion !== definitionRef.nodeTypeVersion) {
        throw new Error(
          `node instance ${nodeId} is already bound to ${ref.nodeTypeId}@${ref.nodeTypeVersion}, not ${definitionRef.nodeTypeId}@${definitionRef.nodeTypeVersion}`,
        );
      }
      return existing;
    }
    if (!this.dependencies.session.store.state.nodes[nodeId]) {
      throw new Error(`cannot activate removed workspace node: ${nodeId}`);
    }
    const runtime = new NodeInstanceRuntime({
      catalog: this.dependencies.nodeLibrary.catalog,
      definitionRef,
      dockElement: this.bodyDock(nodeId),
      createHost: (definition) => createRuntimeHost(this.dependencies, nodeId, definition, this.headerDock(nodeId)),
    });
    this.runtimes.set(nodeId, runtime);
    this.runtimeRefs.set(nodeId, definitionRef);
    void runtime.start();
    return runtime;
  }

  get(nodeId: string): NodeInstanceRuntime | undefined {
    return this.runtimes.get(nodeId);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.documentSubscription.unsubscribe();
    const errors: unknown[] = [];
    const nodeIds = [...this.runtimes.keys()];
    for (let index = nodeIds.length - 1; index >= 0; index -= 1) {
      try {
        this.disposeInstance(nodeIds[index]);
      } catch (error) {
        errors.push(error);
      }
    }
    for (const element of this.bodyDocks.values()) element.remove();
    for (const element of this.headerDocks.values()) element.remove();
    this.bodyDocks.clear();
    this.headerDocks.clear();
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) throw new AggregateError(errors, "Workspace node runtime disposal failed");
  }

  private disposeRemovedInstances(): void {
    const nodes = this.dependencies.session.store.state.nodes;
    const errors: unknown[] = [];
    for (const nodeId of this.runtimes.keys()) {
      if (nodes[nodeId]) continue;
      try {
        this.disposeInstance(nodeId);
      } catch (error) {
        errors.push(error);
      }
    }
    for (const [nodeId, element] of this.bodyDocks) {
      if (!nodes[nodeId]) {
        element.remove();
        this.bodyDocks.delete(nodeId);
      }
    }
    for (const [nodeId, element] of this.headerDocks) {
      if (!nodes[nodeId]) {
        element.remove();
        this.headerDocks.delete(nodeId);
      }
    }
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) throw new AggregateError(errors, "Removed node runtime disposal failed");
  }

  private disposeInstance(nodeId: string): void {
    const runtime = this.runtimes.get(nodeId);
    if (!runtime) return;
    this.runtimes.delete(nodeId);
    this.runtimeRefs.delete(nodeId);
    runtime.dispose();
  }

  private assertLive(): void {
    if (this.disposed) throw new Error("Workspace node runtime manager is disposed");
  }
}
