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

import { Coordination } from "@/core/coordination/coordination";
import { patchNodeConfig, predicateSql, predicateSqls, type GraphNodeCookHost } from "@/core/graph/cook";
import { GraphEvaluator, type GraphEvaluationStore, type GraphNodeRegistrationContext } from "@/core/graph/evaluator";
import { andPreds, type Predicate } from "@/core/graph/engine";
import type { GraphDocumentEdge, GraphDocumentNode, GraphNodeType } from "@/core/graph/records";
import { AUTHORED_GRAPH_OUTPUT_PORT, DERIVED_GRAPH_OUTPUT_PORT, type GraphPortValue } from "@/core/graph/values";
import type { TransformCapabilities } from "@/core/graph/graph-host";
import type { NodeHost } from "@ndea/sdk";
import type { ThresholdFilterConfig } from "@/nodes/transform-filter/view";
import type { Metadata } from "@/types";
import type { NdForm } from "@/components/nd/nd-resolve-form";
import { toRows } from "@/lib/mosaic-helpers";
import type { WorkspaceNodeDescriptor, WorkspaceNodeLibrary } from "./node-kit";
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
  nodeLibrary: WorkspaceNodeLibrary;
}

export type WorkspaceDocumentStore = Pick<Store<WorkspaceDocumentState>, "state" | "get" | "subscribe">;

const EMPTY: WorkspaceDocumentState = {
  nodes: {},
  edges: {},
  positions: {},
  sizeOverrides: {},
  formOverride: {},
  formLocked: {},
  selection: null,
  selSet: [],
  selectedEdge: null,
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
  readonly deps: WorkspaceDeps;
  readonly coordination: Coordination;

  private readonly evaluator: GraphEvaluator;
  private nodeSeq = 0;
  private edgeSeq = 0;
  private disposers = new Map<string, () => void>();
  private evaluationNodeOverrides = new Map<string, GraphDocumentNode>();

  constructor(deps: WorkspaceDeps) {
    this.deps = deps;
    this.evaluator = new GraphEvaluator({
      schedule: (flush) => requestAnimationFrame(flush),
      // bypass: pred inputs pass through uncooked (counts ripple as if absent)
      passthrough: (inputs) => ({ kind: "pred", sql: andPreds(predicateSqls(inputs)) }),
      onFlush: () => this.counts.refresh(),
    });
    this.documentStore = new Store<WorkspaceDocumentState>(EMPTY);
    this.store = this.documentStore;
    // restore the persisted disposition (a loaded document overrides this via
    // loadDocument's {...EMPTY, ...state}; the seed path keeps it)
    const savedDisp = typeof localStorage !== "undefined" ? localStorage.getItem("ndea.disposition") : null;
    if (savedDisp === "strip" || savedDisp === "full" || savedDisp === "hidden") {
      this.documentStore.setState((s) => ({ ...s, disposition: savedDisp }));
    }
    this.coordination = new Coordination(this.documentStore);
    this.telemetry = this.evaluator.telemetry;
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
    return this.evaluator.epoch;
  }

  pullGraphNode(id: string): GraphPortValue {
    return this.evaluator.pull(id);
  }

  registerGraphSink(id: string, listener: (value: GraphPortValue) => void): () => void {
    return this.evaluator.registerSink(id, listener);
  }

  markGraphNodeDirty(id: string): void {
    this.evaluator.markDirty(id);
  }

  def(id: string): WorkspaceNodeDescriptor | null {
    const n = this.store.state.nodes[id];
    return n ? (this.deps.nodeLibrary.getDescriptor(n.type) ?? null) : null;
  }

  private requireNodeDescriptor(type: GraphNodeType): WorkspaceNodeDescriptor {
    const descriptor = this.deps.nodeLibrary.getDescriptor(type);
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
    const ep = this.graphEvaluationEndpoints(fromId, toId);
    return this.evaluator.canConnect({ from: ep.from, to: ep.to });
  }

  /* ── topology actions ─────────────────────────────────────────────── */

  addNode(type: GraphNodeType, pos: WorkspaceNodePosition, idOverride?: string): string {
    const def = this.requireNodeDescriptor(type);
    const id = idOverride ?? `${type}-${++this.nodeSeq}`;
    const parent = this.store.state.graphPath;
    const node: GraphDocumentNode = { id, type, kind: def.kind, label: def.label, pluginId: def.pluginId, parent };
    this.registerGraphNode(id, def);
    this.documentStore.setState((s) => ({
      ...s,
      nodes: { ...s.nodes, [id]: node },
      positions: { ...s.positions, [id]: pos },
      selection: id,
    }));
    if (type === "subnet") this.birthSubnetSeam(id);
    return id;
  }

  /** a subnet is born with its proxy seam markers + the hidden ⊲out→subnet
   *  engine edge that makes the subnet emit its inner result (C9) */
  private birthSubnetSeam(subId: string): void {
    for (const [suffix, label, x] of [
      ["-in", "⊳ in", 60],
      ["-out", "⊲ out", 760],
    ] as const) {
      const pid = `${subId}${suffix}`;
      const pdef = this.requireNodeDescriptor("proxy");
      const pnode: GraphDocumentNode = { id: pid, type: "proxy", kind: "proxy", label, pluginId: null, parent: subId };
      this.registerGraphNode(pid, pdef);
      this.documentStore.setState((s) => ({
        ...s,
        nodes: { ...s.nodes, [pid]: pnode },
        positions: { ...s.positions, [pid]: { x, y: 160 } },
      }));
    }
    this.evaluator.connect({ from: `${subId}-out`, to: subId, toPort: "in" });
  }

  removeNode(id: string): void {
    const def = this.def(id);
    if (!def || def.type === "obs") return; // the source is permanent
    this.disposers.get(id)?.();
    this.disposers.delete(id);
    this.evaluator.removeNode(id);
    this.dropDockEl(id);
    this.dropHeaderEl(id);
    this.frozenPredicates.delete(id);
    this.frozenRows.delete(id);
    this.collectionBindings.delete(id);
    this.transformHosts.delete(id);
    this.wranglePreds.delete(id);
    if (this.ui.state.fullscreen === id) this.setFullscreen(null);
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
        selection: s.selection === id ? null : s.selection,
        selSet: s.selSet.filter((x) => x !== id),
      };
    });
  }

  /** the engine endpoints for a presentation edge — a subnet target routes
   *  to its ⊳ in proxy (the engine stays flat; C9) */
  private graphEvaluationEndpoints(fromId: string, toId: string): { from: string; to: string } {
    const to = this.store.state.nodes[toId]?.type === "subnet" ? `${toId}-in` : toId;
    return { from: fromId, to };
  }

  connect(fromId: string, toId: string): boolean {
    if (!this.canConnectWire(fromId, toId)) return false;
    const kind = this.def(fromId)!.outKind;
    // every wire is an engine edge: pred reads the source's DERIVED output
    // ("out"); sel/focus read its AUTHORED emission port (push unified into
    // pull — engine.emit + ordinary delivery).
    const ep = this.graphEvaluationEndpoints(fromId, toId);
    const fromPort = kind === "pred" ? DERIVED_GRAPH_OUTPUT_PORT : AUTHORED_GRAPH_OUTPUT_PORT;
    if (!this.evaluator.connect({ from: ep.from, fromPort, to: ep.to, toPort: "in" })) return false;
    const id = `e${++this.edgeSeq}`;
    const edge: GraphDocumentEdge = { id, from: fromId, to: toId, toPort: "in", kind };
    this.documentStore.setState((s) => ({ ...s, edges: { ...s.edges, [id]: edge } }));
    return true;
  }

  deleteEdge(edgeId: string): void {
    const edge = this.store.state.edges[edgeId];
    if (!edge) return;
    {
      const ep = this.graphEvaluationEndpoints(edge.from, edge.to);
      const fromPort = edge.kind === "pred" ? DERIVED_GRAPH_OUTPUT_PORT : AUTHORED_GRAPH_OUTPUT_PORT;
      this.evaluator.disconnect({ from: ep.from, fromPort, to: ep.to, toPort: edge.toPort });
    }
    this.documentStore.setState((s) => {
      const edges = { ...s.edges };
      delete edges[edgeId];
      return { ...s, edges, selectedEdge: s.selectedEdge === edgeId ? null : s.selectedEdge };
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
   * rebinds from its `config`. A cache node's pin (`frozenPredicates`) is NOT
   * persisted, so a loaded cache restarts live (passing its input through) even if
   * it was pinned when saved — a graceful degradation, never a corrupt-state load.
   *
   * Call once on a brand-new Workspace (the load-or-seed seam), in place of
   * `seedWorkspace`. Assumes the doc already passed {@link validateDoc}.
   */
  loadDocument(state: WorkspaceDocumentState): void {
    // register each node's cook in the engine (the `addNode` engine half).
    // Proxies are persisted store nodes (a subnet's ⊳in/⊲out seam markers), so
    // they are registered here like any other node — only their hidden seam edge
    // (added by `birthSubnetSeam`, never persisted) is recreated per subnet.
    for (const node of Object.values(state.nodes)) {
      const def = this.deps.nodeLibrary.getDescriptor(node.type);
      if (!def) continue; // unknown type (older/newer doc) — skip rather than throw
      this.registerGraphNode(node.id, def);
    }
    for (const node of Object.values(state.nodes)) {
      if (node.type === "subnet") this.recreateSubnetSeam(node.id);
    }

    // reconnect presentation edges through the engine (the `connect` engine half):
    // a pred edge reads the source's derived "out"; a sel/focus edge reads its
    // authored push port; a subnet target routes to its ⊳in proxy. Endpoints are
    // resolved against the doc being loaded — the store isn't committed yet.
    for (const edge of Object.values(state.edges)) {
      if (!state.nodes[edge.from] || !state.nodes[edge.to]) continue;
      const to = state.nodes[edge.to]?.type === "subnet" ? `${edge.to}-in` : edge.to;
      const fromPort = edge.kind === "pred" ? DERIVED_GRAPH_OUTPUT_PORT : AUTHORED_GRAPH_OUTPUT_PORT;
      this.evaluator.connect({ from: edge.from, fromPort, to, toPort: edge.toPort });
    }

    // re-derive engine flags that live outside the document: a bypassed node (and
    // a bypassed subnet's ⊲out seam) re-arms its pass-through.
    for (const [id, f] of Object.entries(state.flags)) {
      if (f?.bypass && state.nodes[id]) {
        this.evaluator.setBypass(id, true);
        if (state.nodes[id]?.type === "subnet") this.evaluator.setBypass(`${id}-out`, true);
      }
    }

    // collection nodes rebind their members-subquery from persisted config so the
    // cook emits the right predicate without waiting for a body mount.
    for (const node of Object.values(state.nodes)) {
      const cfg = node.config as { collectionId?: unknown; collectionName?: unknown } | undefined;
      if (node.type === "collection" && typeof cfg?.collectionId === "string") {
        this.collectionBindings.set(node.id, { id: cfg.collectionId, version: 0 });
      }
    }

    // keep the id sequences ahead of every restored id so a subsequent addNode /
    // connect can't mint a colliding id.
    this.nodeSeq = Math.max(this.nodeSeq, maxSeq(Object.keys(state.nodes)));
    this.edgeSeq = Math.max(this.edgeSeq, maxSeq(Object.keys(state.edges)));

    // commit the document in one write — the store is the topology/presentation
    // authority; the engine (above) is the cook authority.
    this.documentStore.setState(() => ({ ...EMPTY, ...state }));
  }

  /** Recreate a subnet's hidden ⊲out→subnet engine edge on load (the seam edge
   *  `birthSubnetSeam` adds — it is engine-only, never a persisted store edge). */
  private recreateSubnetSeam(subId: string): void {
    this.evaluator.connect({ from: `${subId}-out`, to: subId, toPort: "in" });
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

  select(id: string | null): void {
    this.documentStore.setState((s) => ({ ...s, selection: id, selectedEdge: null }));
  }

  setSelSet(ids: string[]): void {
    this.documentStore.setState((s) => ({ ...s, selSet: ids }));
  }

  selectEdge(id: string | null): void {
    this.documentStore.setState((s) => ({ ...s, selectedEdge: id }));
  }

  setGraphSelection(nodeIds: readonly string[], edgeIds: readonly string[]): void {
    this.documentStore.setState((state) => ({
      ...state,
      selection: nodeIds.length === 1 ? nodeIds[0] : null,
      selSet: nodeIds.length > 1 ? [...nodeIds] : [],
      selectedEdge: edgeIds.length === 1 ? edgeIds[0] : null,
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
    this.evaluator.setTelemetryEnabled(on);
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
      this.evaluator.setBypass(id, next);
      if (this.store.state.nodes[id]?.type === "subnet") this.evaluator.setBypass(`${id}-out`, next);
    } else {
      // display-off: the BodyOwner unregisters its sink (branch never cooks);
      // dirty downstream so LEDs reflect the parked branch
      this.evaluator.markDirty(id);
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
  emitLasso(nodeId: string, sql: string | null, rowIds: readonly number[] | null = null): void {
    // inline small-lasso predicates carry the ids in the SQL text
    let ids = rowIds;
    if (!ids && sql) {
      const m = sql.match(/__row_index__\s+IN\s*\(([^)]+)\)/i);
      if (m)
        ids = m[1]
          .split(",")
          .map((x) => Number(x.trim()))
          .filter((n) => Number.isFinite(n));
    }
    this.evaluator.emit(nodeId, AUTHORED_GRAPH_OUTPUT_PORT, { kind: "sel", sql, rowIds: ids });
  }

  getLasso(nodeId: string): Extract<GraphPortValue, { kind: "sel" }> | undefined {
    const v = this.evaluator.getEmission(nodeId, AUTHORED_GRAPH_OUTPUT_PORT);
    return v?.kind === "sel" ? v : undefined;
  }

  /** A table row focus lands on its push port (focus wires deliver it). */
  emitFocus(nodeId: string, obsId: string | null): void {
    this.evaluator.emit(nodeId, AUTHORED_GRAPH_OUTPUT_PORT, { kind: "focus", obsId });
  }

  /** pinned row-set snapshots per cache node (resolved ids at pin time; null =
   *  pinned but ids unresolved, e.g. a pred input that carried no row list) */
  readonly frozenRows = new Map<string, number[] | null>();

  /** Is this cache node currently holding a pinned snapshot (cached), or live? */
  isCached(id: string): boolean {
    return this.frozenPredicates.has(id);
  }

  /** Read this cache node's live input value (the same value its cook sees when
   *  uncached). Drives the body's "live count" + the pin action. */
  liveCacheInput(id: string): Extract<GraphPortValue, { kind: "sel" }> | { kind: "pred"; sql: string | null } | null {
    // a sel edge (scatter lasso / table selection) delivers via the source's
    // push port; a pred edge pulls the source's cooked output.
    let sel: Extract<GraphPortValue, { kind: "sel" }> | undefined;
    const predSqlsIn: Predicate[] = [];
    for (const e of Object.values(this.store.state.edges)) {
      if (e.to !== id) continue;
      if (e.kind === "sel") {
        const v = this.evaluator.getEmission(e.from, AUTHORED_GRAPH_OUTPUT_PORT);
        if (v?.kind === "sel") sel = v;
      } else {
        const v = this.evaluator.pull(e.from);
        predSqlsIn.push(predicateSql(v));
      }
    }
    if (sel) return sel;
    const sql = andPreds(predSqlsIn);
    return sql !== null || predSqlsIn.length > 0 ? { kind: "pred", sql } : null;
  }

  /** ◆ Cache / Recache: PIN the cache node's current live input by value. The
   *  push→pull conversion happens exactly here. Returns false if there's
   *  nothing live to pin. */
  pinCache(cacheId: string): boolean {
    const live = this.liveCacheInput(cacheId);
    if (!live) return false;
    const rowIds = live.kind === "sel" && live.rowIds ? [...live.rowIds] : null;
    // Freeze a SELF-CONTAINED predicate. A live sel's sql may reference a
    // transient server temp table (`sel_<id>`) that's dropped when the source
    // clears/unmounts — fatal for a pin that must outlive it. If we have the
    // rows, freeze an `IN (…)` literal instead so the pin is durable at any
    // size; fall back to the live sql for pred inputs (Filters etc.), which are
    // Materialize very large selections if realistic lasso sizes outgrow this IN-list.
    const frozen = rowIds && rowIds.length > 0 ? `__row_index__ IN (${rowIds.join(", ")})` : live.sql;
    if (!frozen) return false;
    this.frozenPredicates.set(cacheId, frozen);
    this.frozenRows.set(cacheId, rowIds);
    this.evaluator.markDirty(cacheId);
    const stamp = this.evaluator.epoch;
    this.documentStore.setState((s) => ({
      ...s,
      nodes: { ...s.nodes, [cacheId]: { ...s.nodes[cacheId], stamp } },
      selection: cacheId,
    }));
    return true;
  }

  /** Drop the pin — return the cache node to live pass-through. */
  uncache(cacheId: string): void {
    if (!this.frozenPredicates.delete(cacheId)) return;
    this.frozenRows.delete(cacheId);
    this.evaluator.markDirty(cacheId);
    this.documentStore.setState((s) => ({
      ...s,
      nodes: { ...s.nodes, [cacheId]: { ...s.nodes[cacheId], stamp: undefined } },
    }));
  }

  /** Scatter *freeze* affordance → a ◆ Cache node wired to the lasso, pinned at
   *  the current rows. Reuses an existing cache node already fed by this scatter
   *  (re-pin == Recache). Supersedes the retired Selection-node flow. */
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

  /* ── collections (C12): persisted selections ──────────────────────── */

  /** collection-node bindings: cook emits a members-subquery predicate */
  readonly collectionBindings = new Map<string, { id: string; version: number }>();

  bindCollection(nodeId: string, c: { id: string; name: string; version: number }): void {
    this.collectionBindings.set(nodeId, { id: c.id, version: c.version });
    this.evaluator.markDirty(nodeId);
    this.documentStore.setState((s) => ({
      ...s,
      nodes: {
        ...s.nodes,
        [nodeId]: {
          ...s.nodes[nodeId],
          config: patchNodeConfig(s.nodes[nodeId], { collectionId: c.id, collectionName: c.name }),
        },
      },
    }));
  }

  unbindCollection(nodeId: string): void {
    this.collectionBindings.delete(nodeId);
    this.evaluator.markDirty(nodeId);
    this.documentStore.setState((state) => ({
      ...state,
      nodes: {
        ...state.nodes,
        [nodeId]: {
          ...state.nodes[nodeId],
          config: patchNodeConfig(state.nodes[nodeId], { collectionId: null, collectionName: null }),
        },
      },
    }));
  }

  /** Export node → saved collection (create API, row_indices mode). Reads the
   *  node's *live* input directly (decoupled from Cache — no pinning). Only a
   *  row-bearing input (a sel: lasso/cache snapshot) can be saved; a pred-only
   *  input has no client-side row ids. */
  async saveAsCollection(nodeId: string, name: string): Promise<{ ok: boolean; error?: string }> {
    const input = this.liveCacheInput(nodeId);
    const rowIds = input?.kind === "sel" ? input.rowIds : null;
    if (!rowIds?.length) {
      return { ok: false, error: "wire a row selection (lasso/cache) — predicates have no row ids to save" };
    }
    const res = await fetch("/api/collections", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, row_indices: rowIds }),
    });
    const data: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      const msg =
        data && typeof data === "object" && "error" in data
          ? String((data as { error: unknown }).error)
          : `HTTP ${res.status}`;
      return { ok: false, error: msg };
    }
    const cid = (data as { result?: { collection_id?: string } }).result?.collection_id;
    if (cid) {
      this.documentStore.setState((s) => ({
        ...s,
        nodes: {
          ...s.nodes,
          [nodeId]: {
            ...s.nodes[nodeId],
            config: patchNodeConfig(s.nodes[nodeId], { collectionId: cid, collectionName: name }),
          },
        },
      }));
    }
    return { ok: true };
  }

  /* ── engine cook wiring per node type ─────────────────────────────── */

  /** Build the lightweight cook host for a built-in node spec. Closes over the
   *  workspace's per-node runtime maps; reads are live (called each cook). */
  private makeCookHost(id: string): GraphNodeCookHost {
    return {
      id,
      node: () => this.evaluationNodeOverrides.get(id) ?? this.store.state.nodes[id],
      frozenPredicate: () => (this.frozenPredicates.has(id) ? (this.frozenPredicates.get(id) ?? null) : undefined),
      wranglePredicate: () => this.wranglePreds.get(id) ?? null,
      collectionBinding: () => this.collectionBindings.get(id),
    };
  }

  private registerGraphNode(id: string, def: WorkspaceNodeDescriptor): void {
    // Unified path: every node type resolves to a registered spec that owns its
    // evaluator cook + kind (no switch). An instance-driven node (the threshold
    // transform) supplies `registerEvaluation` and owns its evaluator registration.
    const spec = this.deps.nodeLibrary.getSpec(def.type);
    if (!spec) throw new Error(`no registered node spec for type "${def.type}"`);
    if (spec.registerEvaluation) {
      spec.registerEvaluation(this.makeGraphNodeRegistrationContext(id));
      return;
    }
    const host = this.makeCookHost(id);
    this.evaluator.addNode({ id, kind: spec.evaluationRole, cook: (inputs) => spec.cook(inputs, host) });
  }

  /** Workspace context handed to a spec's `registerEvaluation` escape hatch — the
   *  minimal engine/runtime plumbing an instance-driven node (threshold) needs,
   *  closed over this workspace's maps. */
  private makeGraphNodeRegistrationContext(id: string): GraphNodeRegistrationContext {
    return {
      id,
      coordinator: this.deps.coordinator,
      table: this.deps.table,
      metadata: this.deps.metadata,
      addNode: (kind, cook) => this.evaluator.addNode({ id, kind, cook }),
      markDirty: () => this.evaluator.markDirty(id),
      onDispose: (fn) => this.disposers.set(id, fn),
      setTransformHost: (host) =>
        this.transformHosts.set(id, host as NodeHost<ThresholdFilterConfig, TransformCapabilities>),
    };
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

  /** stable per-node dock element — the ONE live body's DOM home (C4).
   *  Sockets adopt it via appendChild; React renders into it via portal. */
  private dockEls = new Map<string, HTMLDivElement>();
  dockEl(id: string): HTMLDivElement {
    let el = this.dockEls.get(id);
    if (!el) {
      el = document.createElement("div");
      el.className = "nd-body-dock";
      el.style.cssText = "display:flex;flex-direction:column;flex:1;min-height:0;min-width:0;height:100%;width:100%;";
      this.dockEls.set(id, el);
    }
    return el;
  }
  dropDockEl(id: string): void {
    const el = this.dockEls.get(id);
    el?.remove();
    this.dockEls.delete(id);
  }

  /** stable per-node HEADER slot element — same reparenting contract as the
   *  body dock, but for the frame/tile header's middle gap. Plugins portal a
   *  compact toolbar into it (host.bodyHeaderElement); the canvas node
   *  header (full form) or the stage tile header adopts it via HeaderSocket. */
  private headerEls = new Map<string, HTMLDivElement>();
  headerEl(id: string): HTMLDivElement {
    let el = this.headerEls.get(id);
    if (!el) {
      el = document.createElement("div");
      el.className = "nd-header-dock";
      // container-type lets the toolbar inside gate its segments on the
      // slot's width (@container queries) — items drop out instead of
      // shrinking into slivers when the node/tile is narrow
      // line-height:1 — portaled toolbar text inherits a flat line box and
      // lands on the same visual line as the header's own furniture
      el.style.cssText =
        "display:flex;align-items:center;flex:1;min-width:0;height:100%;overflow:hidden;container-type:inline-size;line-height:1;";
      this.headerEls.set(id, el);
    }
    return el;
  }
  dropHeaderEl(id: string): void {
    const el = this.headerEls.get(id);
    el?.remove();
    this.headerEls.delete(id);
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
      .filter(
        (n) => this.requireNodeDescriptor(n.type).stage !== "canvas-only" && this.placementOf(n.id) === "embedded",
      )
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
    this.documentStore.setState((s) => ({ ...s, graphPath: id, selection: id, claimed: null }));
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
    const sel = s.selSet.filter((id) => {
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
      return { ...st, nodes, positions, selSet: [], selection: subId };
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

  /** transform-node hosts (the node body renders the plugin Component against this) */
  readonly transformHosts = new Map<string, NodeHost<ThresholdFilterConfig, TransformCapabilities>>();
  /** cache-node pinned predicates — presence == "cached"; absence == "live"
   *  (the cook passes its input through). The pin layer over live propagation. */
  readonly frozenPredicates = new Map<string, Predicate>();
  /** wrangle-node compiled predicates (PRQL → SQL membership; cook reads this) */
  readonly wranglePreds = new Map<string, Predicate>();

  /** wrangle editor → document text (persist-ready); compile is the body's job */
  setWranglePrql(id: string, prql: string): void {
    this.documentStore.setState((s) => ({
      ...s,
      nodes: { ...s.nodes, [id]: { ...s.nodes[id], config: patchNodeConfig(s.nodes[id], { prql }) } },
    }));
  }

  /** dataset source → selected `_dataset` key (undefined = all); re-cooks downstream */
  setDatasetKey(id: string, datasetKey: string | undefined): void {
    const current = this.store.state.nodes[id];
    if (!current) return;
    const next: GraphDocumentNode = {
      ...current,
      config: patchNodeConfig(current, { datasetKey: datasetKey ?? null }),
    };

    // A synchronous evaluator scheduler must cook against the pending config
    // before document subscribers can observe it. With the normal rAF scheduler,
    // the committed document becomes the live cook source before the flush.
    this.evaluationNodeOverrides.set(id, next);
    try {
      this.evaluator.markDirty(id);
    } finally {
      this.evaluationNodeOverrides.delete(id);
    }
    this.documentStore.setState((state) => ({
      ...state,
      nodes: { ...state.nodes, [id]: next },
    }));
  }

  /** wrangle body → compiled predicate; dirties the node so the graph re-cooks */
  setWranglePred(id: string, sql: Predicate): void {
    const prev = this.wranglePreds.get(id) ?? null;
    if (prev === sql) return;
    this.wranglePreds.set(id, sql);
    this.evaluator.markDirty(id);
  }

  dispose(): void {
    this.evaluator.dispose();
    this.counts.dispose();
    for (const d of this.disposers.values()) d();
    this.disposers.clear();
    this.evaluationNodeOverrides.clear();
    this.frozenPredicates.clear();
    this.frozenRows.clear();
    this.collectionBindings.clear();
    this.transformHosts.clear();
    this.wranglePreds.clear();
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
  const fov = ws.addNode("fov", { x: 1300, y: 220 });
  ws.connect(obs, wr);
  ws.connect(wr, count);
  ws.connect(wr, table);
  ws.connect(wr, scatter);
  ws.connect(table, fov); // focus push wire — routes outside the engine
  ws.select(scatter);
}
