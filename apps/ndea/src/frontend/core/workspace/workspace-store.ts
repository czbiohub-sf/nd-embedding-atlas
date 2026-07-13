/**
 * Workspace — ONE graph document, projected. The TanStack store is the
 * topology + presentation authority; the GraphEngine is the cook
 * authority. Every topology mutation goes through the actions here, which
 * mirror it into the engine (pred edges only — sel/focus are push wires
 * and route through the push-router, never pulled).
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
  type CoordinationScopeCellPort,
} from "@/core/coordination/coordination";
import { predicateSql } from "@/core/graph/cook";
import type { GraphEvaluationStore } from "@/core/graph/evaluator";
import type { GraphDocumentEdge, GraphDocumentNode, GraphNodeType } from "@/core/graph/records";
import { GraphRuntimeSession, type GraphNodeResolution, type CheckpointInput } from "@/core/graph/runtime-session";
import type { NodeRuntimeSessionPort } from "@/core/node/runtime/session-port";
import type { RowIndex } from "@ndea/sdk";
import type { Metadata } from "@/types";
import type { NdForm } from "@/components/nd/nd-resolve-form";
import { toRows } from "@/lib/mosaic-helpers";
import type { AppNodeDescriptor, AppNodeLibrary } from "@/core/node/library";
import { NodeCounts } from "./node-counts";
import {
  treeMapLeaves,
  treeRemove,
  treeSetRatio,
  treeSplitLeaf,
  treeSwap,
  type SplitWord,
  type TreeNode,
} from "./stage/split-tree";
import type {
  WorkspaceCanvasDisposition,
  WorkspaceDocumentState,
  WorkspaceNodePosition,
  WorkspaceNodeSize,
  WorkspacePlacement,
} from "./types";

export interface WorkspaceDeps {
  coordinator: Coordinator;
  table: string;
  metadata: Metadata;
  nodeLibrary: AppNodeLibrary;
}

export type WorkspaceDocumentStore = Pick<Store<WorkspaceDocumentState>, "state" | "get" | "subscribe">;

const EMPTY: WorkspaceDocumentState = {
  nodes: {},
  edges: {},
  positions: {},
  sizeOverrides: {},
  formOverride: {},
  formLocked: {},
  selectedNodeId: null,
  selectedNodeIds: [],
  selectedEdgeId: null,
  explicit: {},
  stageTree: null,
  disposition: "strip",
  stripH: 280,
  claimed: null,
  graphPath: null,
  flags: {},
  coordinationScopes: {},
  coordinationSpace: {},
};

/** FLIP relocation ghost (pin/pull) */
export interface GhostState {
  from: DOMRect;
  to: DOMRect;
  label: string;
}

export class Workspace {
  private readonly documentStore: Store<WorkspaceDocumentState>;
  readonly store: WorkspaceDocumentStore;
  readonly telemetry: GraphEvaluationStore;
  readonly counts: NodeCounts;
  readonly nodeLibrary: AppNodeLibrary;
  readonly coordination: CoordinationScopeCellPort;

  private readonly graphRuntime: GraphRuntimeSession;
  private readonly deps: WorkspaceDeps;
  private nodeSeq = 0;
  private edgeSeq = 0;

  constructor(deps: WorkspaceDeps) {
    this.deps = deps;
    this.nodeLibrary = deps.nodeLibrary;
    this.documentStore = new Store<WorkspaceDocumentState>(EMPTY);
    this.store = this.documentStore;
    this.graphRuntime = new GraphRuntimeSession({
      resolver: deps.nodeLibrary,
      document: {
        node: (id) => this.documentStore.state.nodes[id],
        edges: () => Object.values(this.documentStore.state.edges),
      },
      schedule: (flush) => requestAnimationFrame(flush),
      onFlush: () => this.counts.refresh(),
    });
    // restore the persisted disposition (a loaded document overrides this via
    // loadDocument's {...EMPTY, ...state}; the seed path keeps it)
    const savedDisp = typeof localStorage !== "undefined" ? localStorage.getItem("ndea.disposition") : null;
    if (savedDisp === "strip" || savedDisp === "full" || savedDisp === "hidden") {
      this.documentStore.setState((s) => ({ ...s, disposition: savedDisp }));
    }
    this.coordination = createCoordination(coordinationDocumentPort(this.documentStore));
    this.telemetry = this.graphRuntime.telemetry;
    this.counts = new NodeCounts({
      // post-flush, cache-aware: the flush just cooked every registered node
      predicateOf: (id) => predicateSql(this.pullGraphNode(id)),
      query: (sql) => this.deps.coordinator.query(sql) as unknown as Promise<unknown>,
      toRows,
      table: deps.table,
    });
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
    return n ? (this.nodeLibrary.getDescriptor(n.type) ?? null) : null;
  }

  nodeResolution(id: string): GraphNodeResolution | null {
    const node = this.store.state.nodes[id];
    return node ? this.graphRuntime.resolutionOf(node) : null;
  }

  unresolvedNodes(): readonly GraphDocumentNode[] {
    return this.graphRuntime.unresolvedNodes(this.store.state.nodes);
  }

  private requireNodeDescriptor(type: GraphNodeType): AppNodeDescriptor {
    const descriptor = this.nodeLibrary.getDescriptor(type);
    if (!descriptor) throw new Error(`no registered node descriptor for type "${type}"`);
    return descriptor;
  }

  /** kind-compatibility + no-duplicate + DAG — the full wire-legality rule */
  canConnectWire(fromId: string, toId: string): boolean {
    if (fromId === toId) return false;
    const from = this.def(fromId);
    const to = this.def(toId);
    if (!from || !to || !from.hasOut || !to.hasIn) return false;
    if (!to.inKinds.includes(from.outKind)) return false;
    const nodes = this.store.state.nodes;
    if ((nodes[fromId]?.parent ?? null) !== (nodes[toId]?.parent ?? null)) return false; // wires live within one level
    const dup = Object.values(this.store.state.edges).some((e) => e.from === fromId && e.to === toId);
    if (dup) return false;
    return this.graphRuntime.canConnect(fromId, toId);
  }

  /* ── topology actions ─────────────────────────────────────────────── */

  addNode(type: GraphNodeType, pos: WorkspaceNodePosition, idOverride?: string): string {
    const def = this.requireNodeDescriptor(type);
    const id = idOverride ?? `${type}-${++this.nodeSeq}`;
    const parent = this.store.state.graphPath;
    const node: GraphDocumentNode = { id, type, kind: def.kind, label: def.label, pluginId: def.pluginId, parent };
    const nodes = [node];
    const positions: Record<string, WorkspaceNodePosition> = { [id]: pos };
    if (type === "subnet") {
      this.requireNodeDescriptor("proxy");
      nodes.push(
        { id: `${id}-in`, type: "proxy", kind: "proxy", label: "⊳ in", pluginId: null, parent: id },
        { id: `${id}-out`, type: "proxy", kind: "proxy", label: "⊲ out", pluginId: null, parent: id },
      );
      positions[`${id}-in`] = { x: 60, y: 160 };
      positions[`${id}-out`] = { x: 760, y: 160 };
    }
    const registered: string[] = [];
    try {
      for (const added of nodes) {
        if (!this.graphRuntime.registerNode(added)) {
          throw new Error(`no graph evaluator registered for type "${added.type}"`);
        }
        registered.push(added.id);
      }
      if (type === "subnet" && !this.graphRuntime.connectSubnetSeam(id)) {
        throw new Error(`graph runtime rejected subnet seam for "${id}"`);
      }
      this.documentStore.setState((state) => ({
        ...state,
        nodes: { ...state.nodes, ...Object.fromEntries(nodes.map((added) => [added.id, added])) },
        positions: { ...state.positions, ...positions },
        selectedNodeId: id,
      }));
    } catch (error) {
      for (let index = registered.length - 1; index >= 0; index -= 1) {
        this.graphRuntime.removeNode(registered[index]);
      }
      throw error;
    }
    return id;
  }

  removeNode(id: string): void {
    const node = this.store.state.nodes[id];
    if (!node || node.type === "obs") return; // the source is permanent
    if (this.ui.state.fullscreen === id) this.setFullscreen(null);
    this.graphRuntime.removeNode(id);
    this.documentStore.setState((s) => {
      const nodes = { ...s.nodes };
      delete nodes[id];
      const positions = { ...s.positions };
      delete positions[id];
      const explicit = { ...s.explicit };
      delete explicit[id];
      const flags = { ...s.flags };
      delete flags[id];
      // drop the node's scope assignments; cell values outlive their members
      // (scopes are named cells, not node-owned — same as the old groupFocus).
      const coordinationScopes = { ...s.coordinationScopes };
      delete coordinationScopes[id];
      const edges = Object.fromEntries(Object.entries(s.edges).filter(([, e]) => e.from !== id && e.to !== id));
      return {
        ...s,
        nodes,
        positions,
        edges,
        explicit,
        flags,
        coordinationScopes,
        stageTree: treeRemove(s.stageTree, id),
        selectedNodeId: s.selectedNodeId === id ? null : s.selectedNodeId,
        selectedNodeIds: s.selectedNodeIds.filter((x) => x !== id),
        selectedEdgeId: s.selectedEdgeId && !edges[s.selectedEdgeId] ? null : s.selectedEdgeId,
      };
    });
  }

  connect(fromId: string, toId: string): boolean {
    if (!this.canConnectWire(fromId, toId)) return false;
    const kind = this.def(fromId)!.outKind;
    const id = `e${++this.edgeSeq}`;
    const edge: GraphDocumentEdge = { id, from: fromId, to: toId, toPort: "in", kind };
    if (!this.graphRuntime.connect(edge)) return false;
    try {
      this.documentStore.setState((s) => ({ ...s, edges: { ...s.edges, [id]: edge } }));
    } catch (error) {
      this.graphRuntime.disconnect(edge);
      throw error;
    }
    return true;
  }

  deleteEdge(edgeId: string): void {
    const edge = this.store.state.edges[edgeId];
    if (!edge) return;
    this.graphRuntime.disconnect(edge);
    this.documentStore.setState((s) => {
      const edges = { ...s.edges };
      delete edges[edgeId];
      return { ...s, edges, selectedEdgeId: s.selectedEdgeId === edgeId ? null : s.selectedEdgeId };
    });
  }

  deleteEdges(ids: string[]): void {
    for (const id of ids) this.deleteEdge(id);
  }

  /* ── persistence: hydrate a saved document ────────────────────────── */

  /**
   * Rehydrate a saved {@link WorkspaceDocumentState} into this (fresh) Workspace — the load
   * half of the persistence seam. The TanStack store is only one of two
   * authorities: a node that merely lands in `store.state` is INERT (the engine
   * never cooks it, so counts/predicates stay empty). So this mirrors the engine
   * registration that `addNode`/`connect` do — register every node's cook
   * (`registerGraphNode`), recreate the hidden subnet seam edge, then reconnect
   * every presentation edge through the same port mapping `connect` uses — before
   * committing the document to the store in one write.
   *
   * Engine-only runtime state that `WorkspaceDocumentState` doesn't carry is re-derived where it
   * can be (`bypass` from `flags`) and otherwise left to re-establish at the body
   * layer: a wrangle recompiles its `prql` → predicate on mount, a collection node
   * rebinds from its `config`. A cache node's checkpoint pin is NOT persisted,
   * so a loaded cache restarts live (passing its input through) even if
   * it was pinned when saved — a graceful degradation, never a corrupt-state load.
   *
   * Call once on a brand-new Workspace (the load-or-seed seam), in place of
   * `seedWorkspace`. Assumes the doc already passed {@link validateDoc}.
   */
  loadDocument(state: WorkspaceDocumentState): void {
    this.graphRuntime.load(state);

    // keep the id sequences ahead of every restored id so a subsequent addNode /
    // connect can't mint a colliding id.
    this.nodeSeq = Math.max(this.nodeSeq, maxSeq(Object.keys(state.nodes)));
    this.edgeSeq = Math.max(this.edgeSeq, maxSeq(Object.keys(state.edges)));

    // commit the document in one write — the store is the topology/presentation
    // authority; the engine (above) is the cook authority.
    this.documentStore.setState(() => ({ ...EMPTY, ...state }));
  }

  /* ── presentation actions ─────────────────────────────────────────── */

  setPosition(id: string, pos: WorkspaceNodePosition): void {
    this.documentStore.setState((s) => ({ ...s, positions: { ...s.positions, [id]: pos } }));
  }

  setPositions(patch: Record<string, WorkspaceNodePosition>): void {
    this.documentStore.setState((s) => ({ ...s, positions: { ...s.positions, ...patch } }));
  }

  /** morph suppression during a body resize drag */
  setResizing(id: string | null): void {
    this.ui.setState((u) => ({ ...u, resizing: id }));
  }

  selectNode(id: string | null): void {
    this.documentStore.setState((s) => ({
      ...s,
      selectedNodeId: id,
      selectedNodeIds: [],
      selectedEdgeId: null,
    }));
  }

  selectEdge(id: string | null): void {
    this.documentStore.setState((s) => ({ ...s, selectedEdgeId: id }));
  }

  setGraphSelection(nodeIds: readonly string[], edgeIds: readonly string[]): void {
    this.documentStore.setState((state) => ({
      ...state,
      selectedNodeId: nodeIds.length === 1 ? nodeIds[0] : null,
      selectedNodeIds: nodeIds.length > 1 ? [...nodeIds] : [],
      selectedEdgeId: edgeIds.length === 1 ? edgeIds[0] : null,
    }));
  }

  releaseClaim(): void {
    this.documentStore.setState((state) => ({ ...state, claimed: null }));
  }

  /** cycle chip → card (→ full when capable) */
  cycleForm(id: string, current: NdForm): void {
    const def = this.def(id);
    if (!def) return;
    const forms: NdForm[] = def.canFull ? ["chip", "card", "full"] : ["chip", "card"];
    const next = forms[(forms.indexOf(current) + 1) % forms.length];
    this.documentStore.setState((s) => ({ ...s, formOverride: { ...s.formOverride, [id]: next } }));
  }

  toggleFormLock(id: string, current: NdForm): void {
    this.documentStore.setState((s) => {
      const on = !s.formLocked[id];
      const formOverride = { ...s.formOverride };
      if (on) formOverride[id] = formOverride[id] ?? current;
      else delete formOverride[id];
      return { ...s, formLocked: { ...s.formLocked, [id]: on }, formOverride };
    });
  }

  /** unlocked overrides clear when the zoom-driven base next changes band */
  clearFreshOverrides(): void {
    this.documentStore.setState((s) => {
      const kept: Record<string, NdForm> = {};
      for (const k in s.formOverride) if (s.formLocked[k]) kept[k] = s.formOverride[k];
      return { ...s, formOverride: kept };
    });
  }

  setSizeOverride(id: string, form: "card" | "full", size: WorkspaceNodeSize): void {
    this.documentStore.setState((s) => ({
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
    if (flag === "bypass" && !(def.kind === "transform" || def.kind === "subnet")) return;
    if (flag === "off" && !(def.kind === "view" && def.pluginId)) return;
    const next = !(this.store.state.flags[id]?.[flag] ?? false);
    if (flag === "bypass") {
      // a bypassed subnet bypasses its seam: route through the ⊲out proxy too
      this.graphRuntime.setBypass(id, next);
      if (this.store.state.nodes[id]?.type === "subnet") this.graphRuntime.setBypass(`${id}-out`, next);
    } else {
      // display-off: the instance runtime unregisters its sink (branch never cooks);
      // dirty downstream so LEDs reflect the parked branch
      this.graphRuntime.markDirty(id);
    }
    this.documentStore.setState((s) => ({
      ...s,
      flags: { ...s.flags, [id]: { ...s.flags[id], [flag]: next } },
    }));
  }

  /* ── authored emissions · freeze · spawn (the ◇ Selection flow) ───── */

  /** A scatter's live lasso lands on its push port as an authored engine
   *  emission; edges deliver it, downstream dirties, and the UI reads it back
   *  via getLasso (reactive through the telemetry epoch). */
  emitLasso(nodeId: string, sql: string | null, rowIds: readonly RowIndex[] | null = null): void {
    this.graphRuntime.emitSelection(nodeId, sql, rowIds);
  }

  getLasso(nodeId: string) {
    return this.graphRuntime.selection(nodeId);
  }

  /** A table row focus lands on its push port (focus wires deliver it). */
  emitFocus(nodeId: string, focusedRowIndex: RowIndex | null): void {
    this.graphRuntime.emitFocus(nodeId, focusedRowIndex);
  }

  /** Is this cache node currently holding a pinned snapshot (cached), or live? */
  isCached(id: string): boolean {
    return this.graphRuntime.isCheckpointPinned(id);
  }

  /** Read this cache node's live input value (the same value its cook sees when
   *  uncached). Drives the body's "live count" + the pin action. */
  liveCacheInput(id: string): CheckpointInput | null {
    return this.graphRuntime.liveCheckpointInput(id);
  }

  /** ◆ Cache / Recache: PIN the cache node's current live input by value. The
   *  push→pull conversion happens exactly here. Returns false if there's
   *  nothing live to pin. */
  pinCache(cacheId: string): boolean {
    const stamp = this.graphRuntime.pinCheckpoint(cacheId);
    if (stamp === null) return false;
    this.documentStore.setState((s) => ({
      ...s,
      nodes: { ...s.nodes, [cacheId]: { ...s.nodes[cacheId], stamp } },
      selectedNodeId: cacheId,
    }));
    return true;
  }

  /** Drop the pin — return the cache node to live pass-through. */
  uncache(cacheId: string): void {
    if (!this.graphRuntime.unpinCheckpoint(cacheId)) return;
    this.documentStore.setState((s) => ({
      ...s,
      nodes: { ...s.nodes, [cacheId]: { ...s.nodes[cacheId], stamp: undefined } },
    }));
  }

  /** Scatter *freeze* affordance → a ◆ Cache node wired to the lasso, pinned at
   *  the current rows. Reuses an existing cache node already fed by this scatter
   *  (re-pin == Recache). */
  freezeSelection(scatterId: string): string | null {
    const live = this.getLasso(scatterId);
    if (!live?.sql) return null;
    let cacheId = Object.values(this.store.state.edges).find(
      (e) => e.from === scatterId && e.kind === "sel" && this.store.state.nodes[e.to]?.type === "cache",
    )?.to;
    if (!cacheId) {
      const p = this.store.state.positions[scatterId] ?? { x: 0, y: 0 };
      cacheId = this.addNode("cache", { x: p.x + 120, y: p.y + (this.def(scatterId)?.full.h ?? 380) + 80 });
      this.connect(scatterId, cacheId);
    }
    this.pinCache(cacheId);
    return cacheId;
  }

  /** global render band + FLIP ghost + resize. Forms default LOCKED to the
   *  largest view (baseForm "full"; capability/placement still cap) — the
   *  graph shouldn't reshape itself while you navigate. zoomForms opts into
   *  zoom-semantic bands (chip/card/full with hysteresis); persisted. */
  readonly ui = new Store<{
    baseForm: NdForm;
    zoomForms: boolean;
    ghost: GhostState | null;
    flipHide: string | null;
    resizing: string | null;
    /** node whose body fills the workspace (third dock adopter); esc exits */
    fullscreen: string | null;
  }>({
    baseForm: "full",
    zoomForms: typeof localStorage !== "undefined" && localStorage.getItem("ndea.zoomForms") === "1",
    ghost: null,
    flipHide: null,
    resizing: null,
    fullscreen: null,
  });

  setFullscreen(id: string | null): void {
    this.ui.setState((u) => ({ ...u, fullscreen: id }));
  }

  /** called by the canvas on zoom (zoomForms only); clears fresh (unlocked) form overrides on band change */
  setBaseForm(form: NdForm): void {
    if (this.ui.state.baseForm === form) return;
    this.ui.setState((u) => ({ ...u, baseForm: form }));
    this.clearFreshOverrides();
  }

  /** toggle zoom-semantic forms; off re-pins every unlocked node to largest */
  setZoomForms(on: boolean): void {
    this.ui.setState((u) => ({ ...u, zoomForms: on }));
    try {
      localStorage.setItem("ndea.zoomForms", on ? "1" : "0");
    } catch {
      /* headless / storage denied — preference just won't persist */
    }
    if (!on) this.setBaseForm("full");
  }

  /* ── placement (embedded ↔ staged) ────────────────────────────────── */

  /** element registry for FLIP measurement — keys "canvas:<id>" / "stage:<id>" */
  readonly els = new Map<string, HTMLElement>();
  registerEl(key: string, el: HTMLElement | null): void {
    if (el) this.els.set(key, el);
    else this.els.delete(key);
  }

  /** placement resolution: descriptor flag → explicit pin → by-disposition default */
  placementOf(id: string): WorkspacePlacement {
    const def = this.def(id);
    if (!def || def.stage === "canvas-only") return "embedded";
    const explicit = this.store.state.explicit[id];
    if (def.stage === "pin-only") return explicit ?? "embedded";
    return explicit ?? (this.store.state.disposition === "full" ? "embedded" : "staged");
  }

  stagedIds(): string[] {
    return Object.keys(this.store.state.nodes).filter((id) => this.placementOf(id) === "staged");
  }

  /** pin ⇡ / pull ⇣ — explicit, persists; animates via the FLIP ghost */
  togglePlacement(id: string, transMs: number): void {
    const cur = this.placementOf(id);
    const next: WorkspacePlacement = cur === "staged" ? "embedded" : "staged";
    const fromEl = this.els.get(cur === "staged" ? `stage:${id}` : `canvas:${id}`);
    const fromRect = fromEl?.getBoundingClientRect() ?? null;
    const label = this.store.state.nodes[id]?.label ?? id;
    this.documentStore.setState((s) => ({ ...s, explicit: { ...s.explicit, [id]: next }, claimed: null }));
    if (!fromRect) return;
    const toKey = next === "staged" ? `stage:${id}` : `canvas:${id}`;
    // measure the destination after the placement commit paints
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const toEl = this.els.get(toKey);
        if (!toEl) return;
        this.ui.setState((u) => ({
          ...u,
          ghost: { from: fromRect, to: toEl.getBoundingClientRect(), label },
          flipHide: toKey,
        }));
        setTimeout(() => this.ui.setState((u) => ({ ...u, ghost: null, flipHide: null })), transMs + 80);
      });
    });
  }

  /* ── stage split-tree ─────────────────────────────────────────────── */

  private slotSeq = 0;

  setStageTree(tree: TreeNode | null): void {
    this.documentStore.setState((s) => ({ ...s, stageTree: tree }));
  }

  splitTile(id: string, dir: SplitWord): void {
    const slotId = `__slot-${++this.slotSeq}`;
    this.setStageTree(treeSplitLeaf(this.store.state.stageTree, id, dir, slotId));
  }

  fillSlot(slotId: string, nodeId: string): void {
    this.documentStore.setState((s) => ({
      ...s,
      stageTree: treeMapLeaves(s.stageTree, (l) => (l === slotId ? nodeId : l)),
      explicit: { ...s.explicit, [nodeId]: "staged" },
    }));
  }

  dismissSlot(slotId: string): void {
    this.setStageTree(treeRemove(this.store.state.stageTree, slotId));
  }

  swapTiles(a: string, b: string): void {
    this.setStageTree(treeSwap(this.store.state.stageTree, a, b));
  }

  setTreeRatio(path: string, ratio: number): void {
    this.setStageTree(treeSetRatio(this.store.state.stageTree, path, ratio));
  }

  /** un-staged stageable nodes — candidates for an empty slot */
  stageCandidates(): string[] {
    return Object.values(this.store.state.nodes)
      .filter((node) => {
        const descriptor = this.nodeLibrary.getDescriptor(node.type);
        return descriptor?.stage !== "canvas-only" && this.placementOf(node.id) === "embedded";
      })
      .map((n) => n.id);
  }

  /* ── pointer claiming (embedded bodies only) ──────────────────────── */

  claim(id: string): void {
    this.documentStore.setState((s) => ({ ...s, claimed: id }));
  }

  release(): void {
    this.documentStore.setState((s) => (s.claimed === null ? s : { ...s, claimed: null }));
  }

  /* ── hierarchy (subnets) ──────────────────────────────────────────── */

  parentOf(id: string): string | null {
    return this.store.state.nodes[id]?.parent ?? null;
  }

  enterSubnet(id: string): void {
    this.documentStore.setState((s) => ({ ...s, graphPath: id, selectedNodeId: id, claimed: null }));
  }

  exitSubnet(): void {
    this.documentStore.setState((s) => ({
      ...s,
      graphPath: s.graphPath ? (s.nodes[s.graphPath]?.parent ?? null) : null,
      claimed: null,
    }));
  }

  jumpLevel(id: string | null): void {
    this.documentStore.setState((s) => ({ ...s, graphPath: id, claimed: null }));
  }

  /** breadcrumb chain for the current level: atlas › … › current */
  crumbs(): { id: string | null; label: string }[] {
    const chain: { id: string | null; label: string }[] = [];
    let p = this.store.state.graphPath;
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
    const sel = s.selectedNodeIds.filter((id) => {
      const n = s.nodes[id];
      return n && n.type !== "obs" && n.type !== "proxy";
    });
    if (sel.length < 2) return null;
    const inSel = new Set(sel);

    // bbox of the selection (card geometry — the wiring diagram is canonical)
    let minX = 1e9;
    let minY = 1e9;
    let maxX = -1e9;
    let maxY = -1e9;
    for (const id of sel) {
      const p = s.positions[id] ?? { x: 0, y: 0 };
      const def = this.requireNodeDescriptor(s.nodes[id].type);
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
    this.documentStore.setState((st) => {
      const nodes = { ...st.nodes };
      const positions = { ...st.positions };
      for (const id of sel) {
        nodes[id] = { ...nodes[id], parent: subId };
        const p = positions[id];
        if (p) positions[id] = { x: p.x + dx, y: p.y + dy };
      }
      positions[`${subId}-in`] = { x: 70, y: 90 + (maxY - minY) / 2 };
      positions[`${subId}-out`] = { x: 320 + (maxX - minX) + 90, y: 90 + (maxY - minY) / 2 };
      return { ...st, nodes, positions, selectedNodeIds: [], selectedNodeId: subId };
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
    this.documentStore.setState((s) => ({ ...s, disposition: d, claimed: null }));
    try {
      localStorage.setItem("ndea.disposition", d);
    } catch {
      /* headless / storage denied — preference just won't persist */
    }
  }

  setStripH(h: number): void {
    this.documentStore.setState((s) => ({ ...s, stripH: h }));
  }

  /** camera-fit hook — registered by the canvas (fitView with duration) */
  requestFit: ((durationMs?: number) => void) | null = null;

  /** SDK host config writes enter the document and invalidate graph evaluation here. */
  updateNodeConfig(id: string, patch: Record<string, unknown>): void {
    const current = this.store.state.nodes[id];
    if (!current) return;
    const next = this.graphRuntime.patchNodeConfig(current, patch);
    this.documentStore.setState((state) => ({
      ...state,
      nodes: { ...state.nodes, [id]: next },
    }));
    this.graphRuntime.markDirty(id);
  }

  dispose(): void {
    this.graphRuntime.dispose();
    this.counts.dispose();
  }
}

/** Highest trailing-integer suffix across ids like `scatter-3` / `e7` (0 if none) —
 *  used on load to keep the node/edge id sequences ahead of every restored id. */
function maxSeq(ids: readonly string[]): number {
  let max = 0;
  for (const id of ids) {
    const m = id.match(/(\d+)$/);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max;
}

/** Seed: the prototype's default document, bound to real plugins. */
export function seedWorkspace(ws: Workspace): void {
  const obs = ws.addNode("obs", { x: 30, y: 340 }, "obs");
  const wr = ws.addNode("wrangle", { x: 290, y: 220 });
  const count = ws.addNode("count", { x: 720, y: 60 });
  const table = ws.addNode("table", { x: 720, y: 220 });
  const scatter = ws.addNode("scatter", { x: 720, y: 620 });
  const imageViewer = ws.addNode("image-viewer", { x: 1300, y: 220 });
  ws.connect(obs, wr);
  ws.connect(wr, count);
  ws.connect(wr, table);
  ws.connect(wr, scatter);
  ws.connect(table, imageViewer); // focus push wire — routes outside the engine
  ws.selectNode(scatter);
}
