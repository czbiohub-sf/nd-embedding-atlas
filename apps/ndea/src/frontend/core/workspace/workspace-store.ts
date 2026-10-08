/**
 * Workspace: ONE graph document, projected. The TanStack store is the
 * topology + presentation authority; the GraphEngine is the cook
 * authority. Every topology mutation goes through the actions here, which
 * mirror it into the engine. Cross-view linking lives in the coordination
 * `state`/`bindings` sections, never on wires.
 *
 * Telemetry: engine cook events land in a separate store (LEDs, wire
 * dashes, cook ms, epoch) so node headers re-render without touching the
 * document.
 */

import { Store } from "@tanstack/store";
import type { Coordinator } from "@uwdata/mosaic-core";

import {
  coordinationDocumentPort,
  createCoordination,
  withoutNodeCoordination,
  type CoordinationScopeCellPort,
} from "@/core/coordination/coordination";
import { COORDINATION_TYPES, filterScopeSql, type CoordinationTypeId } from "@/core/coordination/types";
import { patchNodeConfig, predicateSql } from "@/core/graph/cook";
import type { GraphEvaluationStore } from "@ndea/graph";
import type { GraphDocumentEdge, GraphDocumentNode } from "@/core/graph/records";
import { GraphRuntimeSession, type GraphNodeResolution } from "@/core/graph/runtime-session";
import type { NodeRuntimeSessionPort } from "@/core/node/runtime/session-port";
import { compareSemanticVersions, type ExactNodeTypeRef } from "@ndea/sdk";
import type { Metadata } from "@/types";
import type { NdForm } from "@/components/node-workspace/nd-resolve-form";
import { toRows } from "@/lib/mosaic-helpers";
import type { AppNodeDescriptor, AppNodeLibrary } from "@/core/node/library";
import {
  canonicalUserNodeAssetBytes,
  createNodeAssetLibrary,
  publishNodeAssetVersion,
  type NodeAssetJsonStorage,
  type NodeAssetLibrary,
} from "@/core/node-asset/library";
import {
  compileNodeAssetSnapshot,
  createWorkspaceAppNodeLibrary,
  resolveWorkspaceNodeAssets,
  type WorkspaceAppNodeLibrary,
} from "@/core/node-asset/resolver";
import { createNodeAssetDraftFromSubgraph, type NodeAssetParameterDraftBinding } from "@/core/node-asset/authoring";
import { draftNextNodeAssetVersion } from "@/core/node-asset/migrations";
import type { NodeAssetDefinition, WorkspaceNodeAssetRecord } from "@/core/node-asset/schema";
import { NodeCounts } from "./node-counts";
import {
  addView,
  fillSlot,
  removeElement,
  removeNodeView,
  setSplitRatio,
  splitElement,
  stageViews,
  swapElements,
  type SplitSide,
  type Stage,
} from "./stage/stage-spec";
import type {
  WorkspaceCanvasDisposition,
  WorkspaceDocument,
  WorkspaceNodePosition,
  WorkspaceNodeSize,
  WorkspacePlacement,
  WorkspaceSession,
} from "./types";
import { emptyWorkspaceDocument } from "./document";

export interface WorkspaceDeps {
  coordinator: Coordinator;
  table: string;
  metadata: Metadata;
  nodeLibrary: AppNodeLibrary;
  nodeAssets?: NodeAssetLibrary;
  nodeAssetStorage?: NodeAssetJsonStorage;
}

export type WorkspaceDocumentStore = Pick<Store<WorkspaceDocument>, "state" | "get" | "subscribe">;

const EMPTY: WorkspaceDocument = emptyWorkspaceDocument();

export class Workspace {
  private readonly documentStore: Store<WorkspaceDocument>;
  readonly store: WorkspaceDocumentStore;
  readonly telemetry: GraphEvaluationStore;
  readonly counts: NodeCounts;
  readonly nodeLibrary: WorkspaceAppNodeLibrary;
  readonly coordination: CoordinationScopeCellPort;

  private readonly graphRuntime: GraphRuntimeSession;
  private readonly deps: WorkspaceDeps;
  private nodeSeq = 0;
  private edgeSeq = 0;
  /** The document being projected; the runtime reads it before subscribers see it. */
  private pending: WorkspaceDocument | null = null;

  constructor(deps: WorkspaceDeps) {
    this.deps = deps;
    this.nodeLibrary = createWorkspaceAppNodeLibrary(
      deps.nodeLibrary,
      compileNodeAssetSnapshot(
        deps.nodeLibrary,
        deps.nodeAssets ?? createNodeAssetLibrary([{ sourceId: "user", kind: "user", assets: [], current: {} }]),
      ),
    );
    this.documentStore = new Store<WorkspaceDocument>(EMPTY);
    this.store = this.documentStore;
    this.graphRuntime = new GraphRuntimeSession({
      resolver: this.nodeLibrary,
      document: {
        node: (id) => this.document.nodes[id],
        edges: () => Object.values(this.document.edges),
        scopeFilter: (id) => filterScopeSql(this.document, id),
      },
      schedule: (flush) => requestAnimationFrame(flush),
      onFlush: () => this.counts.refresh(),
    });
    this.coordination = createCoordination({
      ...coordinationDocumentPort(this.documentStore),
      update: (mutator) => this.commit((state) => mutator(state) as WorkspaceDocument),
    });
    this.telemetry = this.graphRuntime.telemetry;
    this.counts = new NodeCounts({
      // post-flush, cache-aware: the flush just cooked every registered node
      predicateOf: (id) => predicateSql(this.pullGraphNode(id)),
      query: (sql) => this.deps.coordinator.query(sql),
      toRows,
      table: deps.table,
    });
  }

  private get document(): WorkspaceDocument {
    return this.pending ?? this.documentStore.state;
  }

  /**
   * The one document write path. The graph runtime is reconciled to the next
   * document first, so store subscribers (React, sync, runtime sinks) only
   * ever observe a document the runtime already reflects. A failed projection
   * rolls the runtime back and leaves the store untouched.
   */
  private commit(update: (state: WorkspaceDocument) => WorkspaceDocument): void {
    const prev = this.documentStore.state;
    const next = update(prev);
    if (next === prev) return;
    this.pending = next;
    try {
      this.reconcile(prev, next);
    } catch (error) {
      this.pending = prev;
      this.reconcile(next, prev);
      throw error;
    } finally {
      this.pending = null;
    }
    this.documentStore.setState(() => next);
  }

  /** Bring the graph runtime from `prev` to `next`; unchanged nodes and edges keep their cooks. */
  private reconcile(prev: WorkspaceDocument, next: WorkspaceDocument): void {
    if (
      prev.nodes === next.nodes &&
      prev.edges === next.edges &&
      prev.flags === next.flags &&
      prev.state === next.state &&
      prev.bindings === next.bindings
    ) {
      return;
    }
    const retyped = (id: string) => {
      const before = prev.nodes[id];
      const after = next.nodes[id];
      return (
        !before || !after || !sameJson(before.definitionRef, after.definitionRef) || before.parent !== after.parent
      );
    };
    const reregistered = new Set(Object.keys({ ...prev.nodes, ...next.nodes }).filter(retyped));

    for (const [id, edge] of Object.entries(prev.edges)) {
      if (!sameJson(edge, next.edges[id])) this.graphRuntime.disconnect(edge, prev.nodes);
    }
    for (const id of Object.keys(prev.nodes)) if (reregistered.has(id)) this.graphRuntime.removeNode(id);
    for (const [id, node] of Object.entries(next.nodes)) {
      if (reregistered.has(id)) this.graphRuntime.registerNode(node);
      else if (!sameJson(prev.nodes[id], node)) this.graphRuntime.recookNode(node, prev.nodes[id]);
    }
    for (const id of reregistered) {
      if (next.nodes[id]?.definitionRef.nodeTypeId === "subnet") this.graphRuntime.connectSubnetSeam(id);
    }
    for (const [id, edge] of Object.entries(next.edges)) {
      const touched = reregistered.has(edge.from) || reregistered.has(edge.to);
      if (touched || !sameJson(edge, prev.edges[id])) this.graphRuntime.connect(edge, next.nodes);
    }
    for (const id of Object.keys(next.nodes)) {
      const before = reregistered.has(id) ? {} : (prev.flags[id] ?? {});
      const after = next.flags[id] ?? {};
      if (Boolean(before.bypass) !== Boolean(after.bypass)) {
        this.graphRuntime.setBypass(id, Boolean(after.bypass));
        // a bypassed subnet bypasses its seam: route through the ⊲out proxy too
        if (next.nodes[id].definitionRef.nodeTypeId === "subnet") {
          this.graphRuntime.setBypass(`${id}-out`, Boolean(after.bypass));
        }
      }
      // display-off: the instance runtime unregisters its sink; dirty so LEDs reflect the parked branch
      if (Boolean(before.off) !== Boolean(after.off)) this.graphRuntime.markDirty(id);
    }
    // Filter scopes feed cooks (views, a live Cache): dirty every node whose scope SQL moved.
    if (prev.state !== next.state || prev.bindings !== next.bindings) {
      for (const id of new Set([...Object.keys(prev.bindings), ...Object.keys(next.bindings)])) {
        if (reregistered.has(id) || !this.graphRuntime.isRegistered(id)) continue;
        if (filterScopeSql(prev, id) !== filterScopeSql(next, id)) this.graphRuntime.markDirty(id);
      }
    }
  }

  /* ── document queries ─────────────────────────────────────────────── */

  get graphEpoch(): number {
    return this.graphRuntime.epoch;
  }

  pullGraphNode(id: string) {
    return this.graphRuntime.pull(id);
  }

  registerGraphSink(id: string, listener: Parameters<NodeRuntimeSessionPort["registerGraphSink"]>[1]): () => void {
    return this.graphRuntime.registerSink(id, listener);
  }

  def(id: string): AppNodeDescriptor | null {
    const n = this.store.state.nodes[id];
    return n ? (this.nodeLibrary.getDescriptorExact(n.definitionRef) ?? null) : null;
  }

  nodeResolution(id: string): GraphNodeResolution | null {
    const node = this.store.state.nodes[id];
    return node ? this.graphRuntime.resolutionOf(node) : null;
  }

  unresolvedNodes(): readonly GraphDocumentNode[] {
    return this.graphRuntime.unresolvedNodes(this.store.state.nodes);
  }

  replaceAvailableNodeAssets(assets: NodeAssetLibrary): void {
    const previous = this.nodeLibrary.assetSnapshot();
    const resolution = resolveWorkspaceNodeAssets(this.nodeLibrary.baseLibrary(), assets, this.store.state.nodeAssets);
    this.nodeLibrary.replaceAssetSnapshot(resolution.snapshot);
    try {
      this.graphRuntime.refreshResolutions(this.store.state);
    } catch (error) {
      this.nodeLibrary.replaceAssetSnapshot(previous);
      try {
        this.graphRuntime.refreshResolutions(this.store.state);
      } catch (rollbackError) {
        // eslint-disable-next-line preserve-caught-error -- AggregateError preserves both independent failures
        throw new AggregateError([error, rollbackError], "Node asset resolution refresh and rollback failed", {
          cause: error,
        });
      }
      throw error;
    }
  }

  private requireNodeDescriptor(ref: ExactNodeTypeRef): AppNodeDescriptor {
    const descriptor = this.nodeLibrary.getDescriptorExact(ref);
    if (!descriptor) throw new Error(`no registered node descriptor for "${ref.nodeTypeId}@${ref.nodeTypeVersion}"`);
    return descriptor;
  }

  /** A node can join a scope of `type` exactly when its definition declares that type's capability. */
  canBindScope(nodeId: string, type: CoordinationTypeId): boolean {
    const node = this.store.state.nodes[nodeId];
    const capabilities = node ? this.nodeLibrary.getSpecExact(node.definitionRef)?.definition.capabilities : undefined;
    return capabilities?.includes(COORDINATION_TYPES[type].capability) ?? false;
  }

  /** A scope hub may link a node that can join `type` and is not already in `scope`. */
  canLinkScope(nodeId: string, type: CoordinationTypeId, scope: string): boolean {
    return this.canBindScope(nodeId, type) && this.coordination.scopeOf(nodeId, type) !== scope;
  }

  /** kind-compatibility + no-duplicate + DAG: the full wire-legality rule */
  canConnectWire(fromId: string, toId: string, fromPortId?: string | null, toPortId?: string | null): boolean {
    if (fromId === toId) return false;
    const from = this.def(fromId);
    const to = this.def(toId);
    if (!from || !to || !from.hasOut || !to.hasIn) return false;
    const output = fromPortId ? from.outputPorts.find((port) => port.id === fromPortId) : from.outputPorts[0];
    const input = toPortId
      ? to.inputPorts.find((port) => port.id === toPortId)
      : to.inputPorts.find((port) => port.kind === output?.kind);
    if (!output || !input || input.kind !== output.kind) return false;
    const nodes = this.store.state.nodes;
    if ((nodes[fromId]?.parent ?? null) !== (nodes[toId]?.parent ?? null)) return false; // wires live within one level
    const dup = Object.values(this.store.state.edges).some(
      (edge) => edge.from === fromId && edge.fromPort === output.id && edge.to === toId && edge.toPort === input.id,
    );
    if (dup) return false;
    return this.graphRuntime.canConnect(fromId, toId, undefined, output.id, input.id);
  }

  /* ── topology actions ─────────────────────────────────────────────── */

  addNode(nodeTypeId: string, pos: WorkspaceNodePosition, idOverride?: string): string {
    const def = this.nodeLibrary.getCurrentDescriptor(nodeTypeId);
    if (!def) throw new Error(`no current node descriptor for type "${nodeTypeId}"`);
    return this.addNodeFromDescriptor(def, pos, idOverride);
  }

  private addNodeExact(ref: ExactNodeTypeRef, pos: WorkspaceNodePosition, idOverride?: string): string {
    return this.addNodeFromDescriptor(this.requireNodeDescriptor(ref), pos, idOverride);
  }

  private addNodeFromDescriptor(def: AppNodeDescriptor, pos: WorkspaceNodePosition, idOverride?: string): string {
    const nodeTypeId = def.definitionRef.nodeTypeId;
    const id = idOverride ?? `${nodeTypeId}-${++this.nodeSeq}`;
    const parent = this.session.state.graphPath;
    const node: GraphDocumentNode = { id, definitionRef: def.definitionRef, label: def.label, parent };
    const assetEntry = this.nodeLibrary.assetSnapshot().assets.getExact(def.definitionRef);
    let assetRecord: WorkspaceNodeAssetRecord | undefined;
    if (assetEntry?.source.kind === "embedded") {
      assetRecord = { kind: "embedded", definition: assetEntry.definition };
    } else if (assetEntry) {
      assetRecord = {
        kind: "linked",
        sourceId: assetEntry.source.sourceId,
        assetRef: {
          assetId: assetEntry.definition.assetId,
          assetVersion: assetEntry.definition.assetVersion,
        },
        nodeTypeRef: assetEntry.definition.nodeTypeRef,
      };
    }
    const nodes = [node];
    const positions: Record<string, WorkspaceNodePosition> = { [id]: pos };
    if (nodeTypeId === "subnet") {
      const proxy = this.nodeLibrary.getCurrentDescriptor("proxy");
      if (!proxy) throw new Error('no current node descriptor for type "proxy"');
      nodes.push(
        { id: `${id}-in`, definitionRef: proxy.definitionRef, label: "⊳ in", parent: id },
        { id: `${id}-out`, definitionRef: proxy.definitionRef, label: "⊲ out", parent: id },
      );
      positions[`${id}-in`] = { x: 60, y: 160 };
      positions[`${id}-out`] = { x: 760, y: 160 };
    }
    if (!this.nodeLibrary.getSpecExact(def.definitionRef)) {
      throw new Error(`no graph evaluator registered for "${nodeTypeId}@${def.definitionRef.nodeTypeVersion}"`);
    }
    this.commit((state) => {
      let nodeAssets = state.nodeAssets;
      if (assetRecord) {
        const assetRef = assetRecord.kind === "linked" ? assetRecord.nodeTypeRef : assetRecord.definition.nodeTypeRef;
        const alreadyRecorded = state.nodeAssets.some((record) => {
          const ref = record.kind === "linked" ? record.nodeTypeRef : record.definition.nodeTypeRef;
          return ref.nodeTypeId === assetRef.nodeTypeId && ref.nodeTypeVersion === assetRef.nodeTypeVersion;
        });
        if (!alreadyRecorded) nodeAssets = [...nodeAssets, assetRecord];
      }
      return {
        ...state,
        nodeAssets,
        nodes: { ...state.nodes, ...Object.fromEntries(nodes.map((added) => [added.id, added])) },
        positions: { ...state.positions, ...positions },
      };
    });
    this.selectNode(id);
    return id;
  }

  createNodeAssetDraft(options: {
    assetId: string;
    assetVersion: string;
    title: string;
    parameters?: readonly NodeAssetParameterDraftBinding[];
    visibility?: NodeAssetDefinition["visibility"];
  }): NodeAssetDefinition {
    const { selectedNodeId, selectedNodeIds } = this.session.state;
    const { nodes, edges } = this.store.state;
    return createNodeAssetDraftFromSubgraph({
      ...options,
      selectedNodeIds: selectedNodeIds.length === 0 && selectedNodeId ? [selectedNodeId] : selectedNodeIds,
      nodes,
      edges,
      resolveDefinition: (ref) => this.nodeLibrary.getSpecExact(ref)?.definition,
      parameters: options.parameters ?? [],
    });
  }

  editNodeAssetDefinition(nodeId: string, nextVersion: string, title?: string): NodeAssetDefinition {
    const node = this.store.state.nodes[nodeId];
    if (!node) throw new Error(`node "${nodeId}" is unavailable`);
    const published = this.nodeLibrary.assetSnapshot().assets.getExact(node.definitionRef)?.definition;
    if (!published) throw new Error(`node "${nodeId}" is not a resolved node asset instance`);
    return draftNextNodeAssetVersion(published, nextVersion, title ? { title } : {});
  }

  publishNodeAssetDraft(
    draft: NodeAssetDefinition,
    options: {
      disposition: "linked" | "embedded";
      sourceId?: string;
      includeFallback?: boolean;
      position: WorkspaceNodePosition;
    },
  ): string {
    const previousSnapshot = this.nodeLibrary.assetSnapshot();
    const previousDocument = this.store.state;
    const previousNodeSeq = this.nodeSeq;
    let assets = previousSnapshot.assets;
    let record: WorkspaceNodeAssetRecord;
    let storedBytes: string | null = null;
    if (options.disposition === "linked") {
      const sourceId = options.sourceId ?? "user";
      const source = assets.sources().find((candidate) => candidate.sourceId === sourceId);
      if (!source) throw new Error(`node asset source "${sourceId}" is unavailable`);
      if (source.kind === "user" && !this.deps.nodeAssetStorage) {
        throw new Error("user node asset storage is unavailable");
      }
      assets = publishNodeAssetVersion(assets, sourceId, draft);
      if (source.kind === "user") {
        const nextSource = assets.sources().find((candidate) => candidate.sourceId === sourceId);
        if (nextSource?.kind !== "user") throw new Error(`user node asset source "${sourceId}" disappeared`);
        storedBytes = canonicalUserNodeAssetBytes(nextSource);
      }
      record = {
        kind: "linked",
        sourceId,
        assetRef: { assetId: draft.assetId, assetVersion: draft.assetVersion },
        nodeTypeRef: draft.nodeTypeRef,
        ...(options.includeFallback ? { fallback: draft } : {}),
      };
    } else {
      const current = assets.getCurrent(draft.assetId);
      if (current && compareSemanticVersions(draft.assetVersion, current.definition.assetVersion) <= 0) {
        throw new Error(
          `published node asset version ${draft.assetVersion} must be newer than ${current.definition.assetVersion}`,
        );
      }
      record = { kind: "embedded", definition: draft };
    }
    const records = [...this.store.state.nodeAssets, record];
    const resolved = resolveWorkspaceNodeAssets(this.nodeLibrary.baseLibrary(), assets, records);
    let id: string | null = null;
    try {
      this.nodeLibrary.replaceAssetSnapshot(resolved.snapshot);
      id = this.addNodeExact(draft.nodeTypeRef, options.position);
      this.commit((state) => ({ ...state, nodeAssets: resolved.records }));
      if (storedBytes !== null) this.deps.nodeAssetStorage!.replaceAtomically(storedBytes);
      return id;
    } catch (error) {
      this.commit(() => previousDocument);
      this.nodeLibrary.replaceAssetSnapshot(previousSnapshot);
      this.nodeSeq = previousNodeSeq;
      throw error;
    }
  }

  removeNode(id: string): void {
    const node = this.store.state.nodes[id];
    if (!node || node.definitionRef.nodeTypeId === "obs") return; // the source is permanent
    const session = this.session.state;
    const remaining = Object.values(this.store.state.edges).filter((e) => e.from !== id && e.to !== id);
    this.patchSession({
      fullscreen: session.fullscreen === id ? null : session.fullscreen,
      selectedNodeId: session.selectedNodeId === id ? null : session.selectedNodeId,
      selectedNodeIds: session.selectedNodeIds.filter((x) => x !== id),
      selectedEdgeId: remaining.some((e) => e.id === session.selectedEdgeId) ? session.selectedEdgeId : null,
    });
    this.commit((s) => {
      const nodes = { ...s.nodes };
      delete nodes[id];
      const positions = { ...s.positions };
      delete positions[id];
      const flags = { ...s.flags };
      delete flags[id];
      const edges = Object.fromEntries(remaining.map((e) => [e.id, e]));
      return withoutNodeCoordination({ ...s, nodes, positions, edges, flags, stage: removeNodeView(s.stage, id) }, id);
    });
  }

  connect(fromId: string, toId: string, fromPortId?: string | null, toPortId?: string | null): boolean {
    if (!this.canConnectWire(fromId, toId, fromPortId, toPortId)) return false;
    const source = this.def(fromId)!;
    const target = this.def(toId)!;
    const output = fromPortId ? source.outputPorts.find((port) => port.id === fromPortId) : source.outputPorts[0];
    if (!output) return false;
    const input = toPortId
      ? target.inputPorts.find((port) => port.id === toPortId)!
      : target.inputPorts.find((port) => port.kind === output.kind)!;
    const kind = output.kind;
    const fromPort = output.id;
    const toPort = input.id;
    const id = `e${++this.edgeSeq}`;
    const edge: GraphDocumentEdge = { id, from: fromId, fromPort, to: toId, toPort, kind };
    this.commit((s) => ({ ...s, edges: { ...s.edges, [id]: edge } }));
    return true;
  }

  deleteEdge(edgeId: string): void {
    const edge = this.store.state.edges[edgeId];
    if (!edge) return;
    if (this.session.state.selectedEdgeId === edgeId) this.patchSession({ selectedEdgeId: null });
    this.commit((s) => {
      const edges = { ...s.edges };
      delete edges[edgeId];
      return { ...s, edges };
    });
  }

  deleteEdges(ids: string[]): void {
    for (const id of ids) this.deleteEdge(id);
  }

  /* ── persistence: hydrate a saved document ────────────────────────── */

  /**
   * Rehydrate a saved {@link WorkspaceDocument} into this fresh Workspace:
   * validate and register the whole graph runtime, then commit the document in
   * one write. Call once at the load seam; later revisions go through
   * {@link applyDocument}. Assumes the document passed `decodeWorkspaceDocument`.
   */
  loadDocument(state: WorkspaceDocument): void {
    const previousSnapshot = this.nodeLibrary.assetSnapshot();
    const previousDocument = this.store.state;
    const previousNodeSeq = this.nodeSeq;
    const previousEdgeSeq = this.edgeSeq;
    const resolvedAssets = resolveWorkspaceNodeAssets(
      this.nodeLibrary.baseLibrary(),
      previousSnapshot.assets,
      state.nodeAssets,
    );
    const canonicalState = { ...state, nodeAssets: resolvedAssets.records };
    let runtimeLoaded = false;
    try {
      this.nodeLibrary.replaceAssetSnapshot(resolvedAssets.snapshot);
      this.graphRuntime.load(canonicalState);
      runtimeLoaded = true;

      // commit the document in one write: the store is the topology/presentation
      // authority; the engine (above) is the cook authority.
      this.documentStore.setState(() => ({ ...EMPTY, ...canonicalState }));

      // keep the id sequences ahead of every restored id so a subsequent
      // addNode/connect can't mint a colliding id.
      this.nodeSeq = Math.max(this.nodeSeq, maxSeq(Object.keys(canonicalState.nodes)));
      this.edgeSeq = Math.max(this.edgeSeq, maxSeq(Object.keys(canonicalState.edges)));
    } catch (error) {
      const rollbackErrors: unknown[] = [];
      if (runtimeLoaded) {
        for (const id of Object.keys(canonicalState.nodes).toReversed()) {
          try {
            this.graphRuntime.removeNode(id);
          } catch (rollbackError) {
            rollbackErrors.push(rollbackError);
          }
        }
      }
      try {
        this.nodeLibrary.replaceAssetSnapshot(previousSnapshot);
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
      try {
        this.documentStore.setState(() => previousDocument);
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
      this.nodeSeq = previousNodeSeq;
      this.edgeSeq = previousEdgeSeq;
      if (rollbackErrors.length > 0) {
        // eslint-disable-next-line preserve-caught-error -- AggregateError preserves activation plus rollback failures
        throw new AggregateError([error, ...rollbackErrors], "Workspace document activation and rollback failed", {
          cause: error,
        });
      }
      throw error;
    }
  }

  /**
   * Move this live Workspace to `next`, a remote or rebased revision. Asset
   * records change node resolution wholesale, so they reload from scratch;
   * every other change goes through the same commit-and-reconcile path as a
   * local edit. Assumes `next` passed `decodeWorkspaceDocument`.
   */
  applyDocument(next: WorkspaceDocument): void {
    const prev = this.store.state;
    if (!sameJson(prev.nodeAssets, next.nodeAssets)) {
      for (const id of Object.keys(prev.nodes).toReversed()) this.graphRuntime.removeNode(id);
      this.documentStore.setState(() => EMPTY);
      this.loadDocument(next);
      return;
    }
    this.commit(() => next);
    this.nodeSeq = Math.max(this.nodeSeq, maxSeq(Object.keys(next.nodes)));
    this.edgeSeq = Math.max(this.edgeSeq, maxSeq(Object.keys(next.edges)));
  }

  /* ── presentation actions ─────────────────────────────────────────── */

  setPosition(id: string, pos: WorkspaceNodePosition): void {
    this.commit((s) => ({ ...s, positions: { ...s.positions, [id]: pos } }));
  }

  setPositions(patch: Record<string, WorkspaceNodePosition>): void {
    this.commit((s) => ({ ...s, positions: { ...s.positions, ...patch } }));
  }

  /** morph suppression during a body resize drag */
  setResizing(id: string | null): void {
    this.patchSession({ resizing: id });
  }

  selectNode(id: string | null): void {
    this.patchSession({ selectedNodeId: id, selectedNodeIds: [], selectedEdgeId: null });
  }

  selectEdge(id: string | null): void {
    this.patchSession({ selectedEdgeId: id });
  }

  setGraphSelection(nodeIds: readonly string[], edgeIds: readonly string[]): void {
    this.patchSession({
      selectedNodeId: nodeIds.length === 1 ? nodeIds[0] : null,
      selectedNodeIds: nodeIds.length > 1 ? [...nodeIds] : [],
      selectedEdgeId: edgeIds.length === 1 ? edgeIds[0] : null,
    });
  }

  releaseClaim(): void {
    this.patchSession({ claimed: null });
  }

  /** cycle chip → card (→ full when capable) */
  cycleForm(id: string, current: NdForm): void {
    const def = this.def(id);
    if (!def) return;
    const forms: NdForm[] = def.canFull ? ["chip", "card", "full"] : ["chip", "card"];
    const next = forms[(forms.indexOf(current) + 1) % forms.length];
    this.commit((s) => ({ ...s, formOverride: { ...s.formOverride, [id]: next } }));
  }

  toggleFormLock(id: string, current: NdForm): void {
    this.commit((s) => {
      const on = !s.formLocked[id];
      const formOverride = { ...s.formOverride };
      if (on) formOverride[id] = formOverride[id] ?? current;
      else delete formOverride[id];
      return { ...s, formLocked: { ...s.formLocked, [id]: on }, formOverride };
    });
  }

  /** unlocked overrides clear when the zoom-driven base next changes band */
  clearFreshOverrides(): void {
    this.commit((s) => {
      const kept: Record<string, NdForm> = {};
      for (const k in s.formOverride) if (s.formLocked[k]) kept[k] = s.formOverride[k];
      return { ...s, formOverride: kept };
    });
  }

  setSizeOverride(id: string, form: "card" | "full", size: WorkspaceNodeSize): void {
    this.commit((s) => ({
      ...s,
      sizeOverrides: { ...s.sizeOverrides, [id]: { ...s.sizeOverrides[id], [form]: size } },
    }));
  }

  setTelemetryEnabled(on: boolean): void {
    this.graphRuntime.setTelemetryEnabled(on);
  }

  /* ── node flags (Houdini b / d) ───────────────────────────────────── */

  flagsOf(id: string): { bypass?: boolean; off?: boolean } {
    return this.store.state.flags[id] ?? {};
  }

  toggleFlag(id: string, flag: "bypass" | "off"): void {
    const def = this.def(id);
    if (!def) return;
    if (flag === "bypass" && !(def.role === "transform" || def.role === "subnet")) return;
    if (flag === "off" && !(def.role === "view" && def.canFull)) return;
    const next = !(this.store.state.flags[id]?.[flag] ?? false);
    this.commit((s) => ({
      ...s,
      flags: { ...s.flags, [id]: { ...s.flags[id], [flag]: next } },
    }));
  }

  /** This tab's editor state: selection, claim, subnet path, disposition, render band, FLIP ghost. */
  readonly session = new Store<WorkspaceSession>({
    selectedNodeId: null,
    selectedNodeIds: [],
    selectedEdgeId: null,
    claimed: null,
    graphPath: null,
    disposition: "strip",
    baseForm: "full",
    zoomForms: false,
    ghost: null,
    flipHide: null,
    resizing: null,
    fullscreen: null,
    assetAuthoring: null,
  });

  private patchSession(patch: Partial<WorkspaceSession>): void {
    this.session.setState((state) => ({ ...state, ...patch }));
  }

  setFullscreen(id: string | null): void {
    this.patchSession({ fullscreen: id });
  }

  openNodeAssetAuthoring(): void {
    this.patchSession({ assetAuthoring: { mode: "create" } });
  }

  openSubnetAssetAuthoring(subnetId: string): void {
    const childIds = Object.values(this.store.state.nodes)
      .filter((node) => node.parent === subnetId && node.definitionRef.nodeTypeId !== "proxy")
      .map((node) => node.id);
    if (childIds.length === 0) throw new Error(`subnet "${subnetId}" has no authorable inner nodes`);
    this.setGraphSelection(childIds, []);
    this.openNodeAssetAuthoring();
  }

  openNodeAssetEditor(nodeId: string): void {
    const node = this.store.state.nodes[nodeId];
    if (!node || !this.nodeLibrary.assetSnapshot().assets.getExact(node.definitionRef)) {
      throw new Error(`node "${nodeId}" is not a resolved node asset instance`);
    }
    this.patchSession({ assetAuthoring: { mode: "edit", nodeId } });
  }

  closeNodeAssetAuthoring(): void {
    this.patchSession({ assetAuthoring: null });
  }

  /** called by the canvas on zoom (zoomForms only); clears fresh (unlocked) form overrides on band change */
  setBaseForm(form: NdForm): void {
    if (this.session.state.baseForm === form) return;
    this.patchSession({ baseForm: form });
    this.clearFreshOverrides();
  }

  /** toggle zoom-semantic forms; off re-pins every unlocked node to largest */
  setZoomForms(on: boolean): void {
    this.patchSession({ zoomForms: on });
    if (!on) this.setBaseForm("full");
  }

  /* ── placement (embedded ↔ staged) ────────────────────────────────── */

  /** element registry for FLIP measurement: keys "canvas:<id>" / "stage:<id>" */
  readonly els = new Map<string, HTMLElement>();
  registerEl(key: string, el: HTMLElement | null): void {
    if (el) this.els.set(key, el);
    else this.els.delete(key);
  }

  /** placement: a node is staged exactly when a Stage View shows it */
  placementOf(id: string): WorkspacePlacement {
    const def = this.def(id);
    if (!def || def.stage === "canvas-only") return "embedded";
    return stageViews(this.store.state.stage).has(id) ? "staged" : "embedded";
  }

  stagedIds(): string[] {
    return [...stageViews(this.store.state.stage).keys()].filter((id) => this.placementOf(id) === "staged");
  }

  /** pin ⇡ / pull ⇣: adds or removes the node's Stage View; animates via the FLIP ghost */
  togglePlacement(id: string, transMs: number): void {
    if (this.def(id)?.stage !== "stageable") return;
    const cur = this.placementOf(id);
    const next: WorkspacePlacement = cur === "staged" ? "embedded" : "staged";
    const fromEl = this.els.get(cur === "staged" ? `stage:${id}` : `canvas:${id}`);
    const fromRect = fromEl?.getBoundingClientRect() ?? null;
    const label = this.store.state.nodes[id]?.label ?? id;
    this.patchSession({ claimed: null });
    this.setStage((stage) => (next === "staged" ? addView(stage, id) : removeNodeView(stage, id)));
    if (!fromRect) return;
    const toKey = next === "staged" ? `stage:${id}` : `canvas:${id}`;
    // measure the destination after the placement commit paints
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const toEl = this.els.get(toKey);
        if (!toEl) return;
        this.patchSession({ ghost: { from: fromRect, to: toEl.getBoundingClientRect(), label }, flipHide: toKey });
        setTimeout(() => this.patchSession({ ghost: null, flipHide: null }), transMs + 80);
      });
    });
  }

  /* ── stage spec (element ids, not node ids) ───────────────────────── */

  private setStage(update: (stage: Stage) => Stage): void {
    this.commit((s) => ({ ...s, stage: update(s.stage) }));
  }

  splitTile(elementId: string, side: SplitSide): void {
    this.setStage((stage) => splitElement(stage, elementId, side)[0]);
  }

  fillSlot(slotId: string, nodeId: string): void {
    this.setStage((stage) => fillSlot(stage, slotId, nodeId));
  }

  dismissSlot(slotId: string): void {
    this.setStage((stage) => removeElement(stage, slotId));
  }

  swapTiles(a: string, b: string): void {
    this.setStage((stage) => swapElements(stage, a, b));
  }

  setSplitRatio(splitId: string, ratio: number): void {
    this.setStage((stage) => setSplitRatio(stage, splitId, ratio));
  }

  /** un-staged stageable nodes: candidates for an empty slot */
  stageCandidates(): string[] {
    return Object.values(this.store.state.nodes)
      .filter((node) => {
        const descriptor = this.nodeLibrary.getDescriptorExact(node.definitionRef);
        return descriptor?.stage !== "canvas-only" && this.placementOf(node.id) === "embedded";
      })
      .map((n) => n.id);
  }

  /* ── pointer claiming (embedded bodies only) ──────────────────────── */

  claim(id: string): void {
    this.patchSession({ claimed: id });
  }

  release(): void {
    if (this.session.state.claimed !== null) this.patchSession({ claimed: null });
  }

  /* ── hierarchy (subnets) ──────────────────────────────────────────── */

  parentOf(id: string): string | null {
    return this.store.state.nodes[id]?.parent ?? null;
  }

  enterSubnet(id: string): void {
    this.patchSession({ graphPath: id, selectedNodeId: id, claimed: null });
  }

  exitSubnet(): void {
    const path = this.session.state.graphPath;
    this.patchSession({ graphPath: path ? this.parentOf(path) : null, claimed: null });
  }

  jumpLevel(id: string | null): void {
    this.patchSession({ graphPath: id, claimed: null });
  }

  /** breadcrumb chain for the current level: atlas › … › current */
  crumbs(): { id: string | null; label: string }[] {
    const chain: { id: string | null; label: string }[] = [];
    let p = this.session.state.graphPath;
    while (p) {
      chain.unshift({ id: p, label: p });
      p = this.parentOf(p);
    }
    return [{ id: null, label: "atlas" }, ...chain];
  }

  /** collapse the marquee selection into a new subnet (Houdini ⇧C):
   *  boundary edges are rewired through the proxy seam; inner edges follow
   *  their nodes; members reparent (positions normalized toward origin) */
  collapseSelection(): string | null {
    const s = this.store.state;
    const sel = this.session.state.selectedNodeIds.filter((id) => {
      const n = s.nodes[id];
      return n && n.definitionRef.nodeTypeId !== "obs" && n.definitionRef.nodeTypeId !== "proxy";
    });
    if (sel.length < 2) return null;
    const inSel = new Set(sel);

    // bbox of the selection (card geometry: the wiring diagram is canonical)
    let minX = 1e9;
    let minY = 1e9;
    let maxX = -1e9;
    let maxY = -1e9;
    for (const id of sel) {
      const p = s.positions[id] ?? { x: 0, y: 0 };
      const def = this.requireNodeDescriptor(s.nodes[id].definitionRef);
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x + def.card.w);
      maxY = Math.max(maxY, p.y + def.card.h);
    }

    const subId = this.addNode("subnet", { x: (minX + maxX) / 2 - 110, y: (minY + maxY) / 2 - 48 });

    // boundary edges (snapshot BEFORE mutation); inner edges follow their nodes
    const boundary = Object.values(s.edges).filter((e) => inSel.has(e.from) !== inSel.has(e.to));
    for (const e of boundary) this.deleteEdge(e.id);

    // reparent members FIRST (wires only connect within one level); inner
    // positions keep their shape, normalized toward origin; proxies bracket
    const dx = 320 - minX;
    const dy = 90 - minY;
    this.commit((st) => {
      const nodes = { ...st.nodes };
      const positions = { ...st.positions };
      for (const id of sel) {
        nodes[id] = { ...nodes[id], parent: subId };
        const p = positions[id];
        if (p) positions[id] = { x: p.x + dx, y: p.y + dy };
      }
      positions[`${subId}-in`] = { x: 70, y: 90 + (maxY - minY) / 2 };
      positions[`${subId}-out`] = { x: 320 + (maxX - minX) + 90, y: 90 + (maxY - minY) / 2 };
      return { ...st, nodes, positions };
    });

    // rewire through the proxy seam (dedupe by from>to)
    const seen = new Set<string>();
    const wire = (f: string, t: string) => {
      const k = `${f}>${t}`;
      if (seen.has(k)) return;
      seen.add(k);
      this.connect(f, t);
    };
    for (const e of boundary) {
      if (inSel.has(e.to)) {
        wire(e.from, subId);
        wire(`${subId}-in`, e.to);
      } else {
        wire(e.from, `${subId}-out`);
        wire(subId, e.to);
      }
    }
    return subId;
  }

  /* ── disposition (strip ↔ full) ───────────────────────────────────── */

  setDisposition(d: WorkspaceCanvasDisposition): void {
    this.patchSession({ disposition: d, claimed: null });
  }

  setStripH(h: number): void {
    this.commit((s) => ({ ...s, stripH: h }));
  }

  /** camera-fit hook: registered by the canvas (fitView with duration) */
  requestFit: ((durationMs?: number) => void) | null = null;

  /** SDK host config writes enter the document; the contract validates before commit. */
  updateNodeConfig(id: string, patch: Record<string, unknown>): void {
    const current = this.store.state.nodes[id];
    if (!current) return;
    const next = patchNodeConfig(
      current,
      patch,
      this.nodeLibrary.getSpecExact(current.definitionRef)?.definition.config,
    );
    this.commit((state) => ({ ...state, nodes: { ...state.nodes, [id]: next } }));
  }

  dispose(): void {
    this.graphRuntime.dispose();
    this.counts.dispose();
  }
}

/** Highest trailing-integer suffix across ids like `scatter-3` / `e7` (0 if none) :
 *  used on load to keep the node/edge id sequences ahead of every restored id. */
function maxSeq(ids: readonly string[]): number {
  let max = 0;
  for (const id of ids) {
    const m = id.match(/(\d+)$/);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max;
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
