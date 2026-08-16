import { Store } from "@tanstack/store";
import { Selection } from "@uwdata/mosaic-core";
import {
  nodeInstanceId,
  type ExactNodeTypeRef,
  type FocusCoordinationAPI,
  type NodeCapability,
  type OrderingCoordinationAPI,
  type RowIndex,
  type ViewCoordinationAPI,
} from "@ndea/sdk";

import { stringPredicate } from "@/lib/mosaic-helpers";
import type { CatalogNodeDefinition } from "@/core/plugin/registration";
import { assertRequiredAppNodeHostFacets } from "@/core/node/app-node-host";
import { createCheckpointCreationNodeFacet, createCheckpointNodeFacet, createHierarchyNodeFacet } from "./host-facets";
import type { AppNodeLibrary } from "@/core/node/library";
import { createAppNodeHost, type AppNodeHostDependencies, type HostHandle } from "./host";
import { NodeInstanceRuntime } from "./instance-runtime";
import type { NodeRuntimeSessionPort } from "./session-port";

interface ViewSyncCell {
  readonly panX?: number;
  readonly panY?: number;
  readonly zoom?: number;
  readonly src?: string;
}

type OrderingCell = { col: string; dir: "asc" | "desc" } | null;

const VIEW_COORDINATION_TYPE = "viewSync";
const VIEW_COORDINATION_LOCK = "lock1";
const FOCUS_COORDINATION_TYPE = "focus";
const ORDERING_COORDINATION_TYPE = "ordering";

export const APP_NODE_HOST_CAPABILITIES: readonly NodeCapability[] = Object.freeze([
  "data-read",
  "row-set-publish",
  "focus-coordination",
  "view-coordination",
  "schema-mutation",
  "spatial-data",
  "gpu-device",
  "wasm-bitmap",
  "compute",
  "annotation-write",
  "ordering-coordination",
  "filter-coordination",
] satisfies NodeCapability[]);

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

function createViewCoordination(session: NodeRuntimeSessionPort, nodeId: string): ViewCoordinationAPI {
  const read = (): ViewSyncCell | undefined => {
    const scope = session.coordination.scopeOf(nodeId, VIEW_COORDINATION_TYPE);
    return scope === undefined
      ? undefined
      : (session.coordination.readCoordination(VIEW_COORDINATION_TYPE, scope) as ViewSyncCell);
  };
  return {
    get panX() {
      return read()?.panX ?? 0;
    },
    get panY() {
      return read()?.panY ?? 0;
    },
    get zoom() {
      return read()?.zoom ?? 1;
    },
    get linked() {
      return session.coordination.scopeOf(nodeId, VIEW_COORDINATION_TYPE) !== undefined;
    },
    broadcast(state) {
      const scope = session.coordination.scopeOf(nodeId, VIEW_COORDINATION_TYPE);
      if (scope === undefined) return;
      session.coordination.setCoordinationValue(VIEW_COORDINATION_TYPE, scope, { ...state, src: nodeId });
    },
    toggleLock() {
      if (session.coordination.scopeOf(nodeId, VIEW_COORDINATION_TYPE) !== undefined) {
        session.coordination.clearScope(nodeId, VIEW_COORDINATION_TYPE);
      } else {
        session.coordination.assignScope(nodeId, VIEW_COORDINATION_TYPE, VIEW_COORDINATION_LOCK);
      }
    },
    subscribe(callback) {
      return session.coordination.subscribe(nodeId, VIEW_COORDINATION_TYPE, (value) => {
        const cell = value as ViewSyncCell | undefined;
        if (cell && cell.src !== nodeId) {
          callback({ panX: cell.panX ?? 0, panY: cell.panY ?? 0, zoom: cell.zoom ?? 1 });
        }
      });
    },
  };
}

function createOrderingCoordination(session: NodeRuntimeSessionPort, nodeId: string): OrderingCoordinationAPI {
  const read = (): OrderingCell => {
    const scope = session.coordination.scopeOf(nodeId, ORDERING_COORDINATION_TYPE);
    return scope === undefined
      ? null
      : ((session.coordination.readCoordination(ORDERING_COORDINATION_TYPE, scope) as OrderingCell) ?? null);
  };
  return {
    get: read,
    set(value) {
      const scope = session.coordination.scopeOf(nodeId, ORDERING_COORDINATION_TYPE);
      if (scope !== undefined) session.coordination.setCoordinationValue(ORDERING_COORDINATION_TYPE, scope, value);
    },
    subscribe(callback) {
      return session.coordination.subscribe(nodeId, ORDERING_COORDINATION_TYPE, (value) =>
        callback((value as OrderingCell) ?? null),
      );
    },
  };
}

function createFocusCoordination(
  session: NodeRuntimeSessionPort,
  nodeId: string,
  localFocus: Store<RowIndex | null>,
): FocusCoordinationAPI {
  const read = (): RowIndex | null => {
    const scope = session.coordination.scopeOf(nodeId, FOCUS_COORDINATION_TYPE);
    return scope === undefined
      ? localFocus.state
      : (session.coordination.readCoordination(FOCUS_COORDINATION_TYPE, scope) ?? null);
  };
  return {
    get: read,
    set(rowIndex) {
      const scope = session.coordination.scopeOf(nodeId, FOCUS_COORDINATION_TYPE);
      if (scope !== undefined) {
        session.coordination.setCoordinationValue(FOCUS_COORDINATION_TYPE, scope, rowIndex);
      } else {
        localFocus.setState(() => rowIndex);
        session.emitFocus(nodeId, rowIndex);
      }
    },
    subscribe(callback) {
      let previous = read();
      const emitChange = () => {
        const value = read();
        if (value === previous) return;
        previous = value;
        callback(value);
      };
      const localSubscription = localFocus.subscribe(emitChange);
      const coordinationSubscription = session.coordination.subscribe(nodeId, FOCUS_COORDINATION_TYPE, emitChange);
      return () => {
        localSubscription.unsubscribe();
        coordinationSubscription();
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
    ? appHost.filterScopes.bind(nodeInstanceId(nodeId))
    : undefined;
  filterBinding?.setScope(session.coordination.scopeOf(nodeId, "filter"));
  const inputPredicate = filterBinding?.selection ?? Selection.single();
  const localFocus = new Store<RowIndex | null>(null);
  const checkpointController = spec?.checkpoint ? new AbortController() : null;
  const graphSource = { __ndeaGraphNode: nodeId };
  const facets = {
    ...(spec?.checkpoint && filterBinding
      ? { checkpoint: createCheckpointNodeFacet(session, nodeId, filterBinding, checkpointController!.signal) }
      : {}),
    ...(spec?.checkpointCreation ? { checkpointCreation: createCheckpointCreationNodeFacet(session, nodeId) } : {}),
    ...(spec?.role === "subnet" ? { hierarchy: createHierarchyNodeFacet(session, nodeId) } : {}),
  };
  assertRequiredAppNodeHostFacets({ ...facets, bodyHeaderElement: headerElement }, spec?.requiredHostFacets ?? []);

  const handle = createAppNodeHost(appHost, {
    instanceId: nodeInstanceId(nodeId),
    definition,
    config: mergeNodeConfig(definition, node.config?.value),
    bodyHeaderElement: headerElement,
    inputPredicate,
    focus: createFocusCoordination(session, nodeId, localFocus),
    viewCoordination: createViewCoordination(session, nodeId),
    ordering: createOrderingCoordination(session, nodeId),
    filter: filterBinding,
    facets,
    patchConfig: (patch) => session.updateNodeConfig(nodeId, patch as Record<string, unknown>),
    onDataRowSetPublished(publication, rowIds) {
      session.emitLasso(nodeId, publication.predicate, rowIds);
    },
  });

  if (filterBinding) {
    handle.host.track(() => filterBinding.dispose());
    handle.host.track(
      session.coordination.subscribeScope(nodeId, "filter", (scope) => {
        filterBinding.setScope(scope);
      }),
    );
  }
  if (checkpointController) handle.host.track(() => checkpointController.abort());

  let graphSinkDisposer: (() => void) | null = null;
  const syncGraphSink = () => {
    const off = session.store.state.flags[nodeId]?.off ?? false;
    if (off || !session.store.state.nodes[nodeId]) {
      graphSinkDisposer?.();
      graphSinkDisposer = null;
      if (filterBinding) filterBinding.setGraphPredicate(null);
      else {
        inputPredicate.update({
          source: graphSource,
          clients: new Set(),
          fields: [],
          value: null,
          predicate: null,
        });
      }
      return;
    }
    if (graphSinkDisposer) return;
    graphSinkDisposer = session.registerGraphSink(nodeId, (value) => {
      if (value === undefined) return;
      if (value.kind === "focus") {
        localFocus.setState(() => value.rowIndex);
        return;
      }
      const sql = spec?.checkpoint ? (session.cacheGraphInput(nodeId)?.sql ?? null) : value.sql;
      if (filterBinding) {
        filterBinding.setGraphPredicate(sql);
        return;
      }
      inputPredicate.update({
        source: graphSource,
        clients: new Set(),
        fields: [],
        value: sql ? [sql] : [],
        predicate: sql ? stringPredicate(sql) : null,
      });
    });
  };
  const documentSubscription = session.store.subscribe(syncGraphSink);
  handle.host.track(() => documentSubscription.unsubscribe());
  handle.host.track(() => {
    graphSinkDisposer?.();
    graphSinkDisposer = null;
  });
  syncGraphSink();
  if (filterBinding && spec?.checkpoint) {
    session.setLiveCachePredicate(nodeId, filterBinding.getResolved().predicate);
    handle.host.track(
      filterBinding.subscribeResolved(({ predicate }) => {
        session.setLiveCachePredicate(nodeId, predicate);
      }),
    );
    handle.host.track(() => session.setLiveCachePredicate(nodeId, null));
  }
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
