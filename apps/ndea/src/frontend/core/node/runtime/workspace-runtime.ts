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
import type { PredicateFacet } from "@/core/buses";
import type { CatalogNodeDefinition } from "@/core/plugin/registration";
import {
  createCheckpointCreationNodeFacet,
  createCheckpointNodeFacet,
  createEdgeInputRowSetBinding,
  createHierarchyNodeFacet,
  deliverEdgeInputRowSet,
} from "@/core/workspace/node-host-facets";
import type { WorkspaceNodeLibrary } from "@/core/workspace/node-projection";
import type { Workspace } from "@/core/workspace/workspace-store";
import { createAppNodeHost, type AppNodeHostDependencies, type HostHandle } from "./host";
import { NodeInstanceRuntime } from "./instance-runtime";

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
  "predicate-publish",
  "row-set-publish",
  "row-set-subscribe",
  "focus-coordination",
  "view-coordination",
  "spatial-data",
  "collection-read",
  "gpu-device",
  "wasm-bitmap",
  "compute",
  "annotation-write",
  "ordering-coordination",
] satisfies NodeCapability[]);

export interface WorkspaceNodeRuntimeManagerDependencies {
  readonly workspace: Workspace;
  readonly nodeLibrary: WorkspaceNodeLibrary;
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

function createViewCoordination(workspace: Workspace, nodeId: string): ViewCoordinationAPI {
  const read = (): ViewSyncCell | undefined => {
    const scope = workspace.coordination.scopeOf(nodeId, VIEW_COORDINATION_TYPE);
    return scope === undefined
      ? undefined
      : (workspace.coordination.readCoordination(VIEW_COORDINATION_TYPE, scope) as ViewSyncCell);
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
      return workspace.coordination.scopeOf(nodeId, VIEW_COORDINATION_TYPE) !== undefined;
    },
    broadcast(state) {
      const scope = workspace.coordination.scopeOf(nodeId, VIEW_COORDINATION_TYPE);
      if (scope === undefined) return;
      workspace.coordination.setCoordinationValue(VIEW_COORDINATION_TYPE, scope, { ...state, src: nodeId });
    },
    toggleLock() {
      if (workspace.coordination.scopeOf(nodeId, VIEW_COORDINATION_TYPE) !== undefined) {
        workspace.coordination.clearScope(nodeId, VIEW_COORDINATION_TYPE);
      } else {
        workspace.coordination.assignScope(nodeId, VIEW_COORDINATION_TYPE, VIEW_COORDINATION_LOCK);
      }
    },
    subscribe(callback) {
      return workspace.coordination.subscribe(nodeId, VIEW_COORDINATION_TYPE, (value) => {
        const cell = value as ViewSyncCell | undefined;
        if (cell && cell.src !== nodeId) {
          callback({ panX: cell.panX ?? 0, panY: cell.panY ?? 0, zoom: cell.zoom ?? 1 });
        }
      });
    },
  };
}

function createOrderingCoordination(workspace: Workspace, nodeId: string): OrderingCoordinationAPI {
  const read = (): OrderingCell => {
    const scope = workspace.coordination.scopeOf(nodeId, ORDERING_COORDINATION_TYPE);
    return scope === undefined
      ? null
      : ((workspace.coordination.readCoordination(ORDERING_COORDINATION_TYPE, scope) as OrderingCell) ?? null);
  };
  return {
    get: read,
    set(value) {
      const scope = workspace.coordination.scopeOf(nodeId, ORDERING_COORDINATION_TYPE);
      if (scope !== undefined) workspace.coordination.setCoordinationValue(ORDERING_COORDINATION_TYPE, scope, value);
    },
    subscribe(callback) {
      return workspace.coordination.subscribe(nodeId, ORDERING_COORDINATION_TYPE, (value) =>
        callback((value as OrderingCell) ?? null),
      );
    },
  };
}

function createFocusCoordination(
  workspace: Workspace,
  nodeId: string,
  localFocus: Store<RowIndex | null>,
): FocusCoordinationAPI {
  const read = (): RowIndex | null => {
    const scope = workspace.coordination.scopeOf(nodeId, FOCUS_COORDINATION_TYPE);
    return scope === undefined
      ? localFocus.state
      : (workspace.coordination.readCoordination(FOCUS_COORDINATION_TYPE, scope) ?? null);
  };
  return {
    get: read,
    set(rowIndex) {
      const scope = workspace.coordination.scopeOf(nodeId, FOCUS_COORDINATION_TYPE);
      if (scope !== undefined) {
        workspace.coordination.setCoordinationValue(FOCUS_COORDINATION_TYPE, scope, rowIndex);
      } else {
        localFocus.setState(() => rowIndex);
        workspace.emitFocus(nodeId, rowIndex);
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
      const coordinationSubscription = workspace.coordination.subscribe(nodeId, FOCUS_COORDINATION_TYPE, emitChange);
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
  const { workspace, nodeLibrary, appHost } = dependencies;
  const node = workspace.store.state.nodes[nodeId];
  if (!node) throw new Error(`workspace node not found: ${nodeId}`);
  const spec = nodeLibrary.getSpec(node.type);
  const inputPredicate = Selection.single();
  const inputRowSet = createEdgeInputRowSetBinding();
  const localFocus = new Store<RowIndex | null>(null);
  const facets = {
    ...(spec?.checkpoint ? { checkpoint: createCheckpointNodeFacet(workspace, nodeId) } : {}),
    ...(spec?.checkpointCreation ? { checkpointCreation: createCheckpointCreationNodeFacet(workspace, nodeId) } : {}),
    ...(spec?.kind === "subnet" ? { hierarchy: createHierarchyNodeFacet(workspace, nodeId) } : {}),
  };

  const handle = createAppNodeHost(appHost, {
    instanceId: nodeInstanceId(nodeId),
    definition,
    config: mergeNodeConfig(definition, node.config),
    bodyHeaderElement: headerElement,
    inputPredicate,
    rowSetInput: inputRowSet,
    focus: createFocusCoordination(workspace, nodeId, localFocus),
    viewCoordination: createViewCoordination(workspace, nodeId),
    ordering: createOrderingCoordination(workspace, nodeId),
    facets,
    patchConfig: (patch) => workspace.updateNodeConfig(nodeId, patch as Record<string, unknown>),
    publishPredicate(facet, sql) {
      if (facet === "lasso") {
        if (workspace.getLasso(nodeId)?.sql !== sql) workspace.emitLasso(nodeId, sql);
      } else {
        appHost.predicateBus.publishPredicate(nodeInstanceId(nodeId), facet as PredicateFacet, sql);
      }
    },
    onDataRowSetPublished(publication, rowIds) {
      workspace.emitLasso(nodeId, publication.predicate, rowIds);
    },
  });

  let graphSinkDisposer: (() => void) | null = null;
  const syncGraphSink = () => {
    const off = workspace.store.state.flags[nodeId]?.off ?? false;
    if (off || !workspace.store.state.nodes[nodeId]) {
      graphSinkDisposer?.();
      graphSinkDisposer = null;
      return;
    }
    if (graphSinkDisposer) return;
    const source = { __ndeaGraphNode: nodeId };
    graphSinkDisposer = workspace.registerGraphSink(nodeId, (value) => {
      if (value === undefined) return;
      deliverEdgeInputRowSet(inputRowSet, value);
      if (value.kind === "focus") {
        localFocus.setState(() => value.rowIndex);
        return;
      }
      const sql = value.sql;
      inputPredicate.update({
        source,
        clients: new Set(),
        value: sql ? [sql] : [],
        predicate: sql ? stringPredicate(sql) : null,
      });
    });
  };
  const documentSubscription = workspace.store.subscribe(syncGraphSink);
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
    this.documentSubscription = dependencies.workspace.store.subscribe(() => this.disposeRemovedInstances());
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
    if (!this.dependencies.workspace.store.state.nodes[nodeId]) {
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
    const nodes = this.dependencies.workspace.store.state.nodes;
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
