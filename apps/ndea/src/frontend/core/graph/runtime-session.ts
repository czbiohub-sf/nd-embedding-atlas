import { rowIndex, type JsonValue, type RowIndex } from "@ndea/sdk";
import {
  patchNodeConfig,
  predicateSql,
  predicateSqls,
  type GraphNodeCookFunction,
  type GraphNodeCookHost,
} from "./cook";
import { GraphEvaluator, type GraphEvaluationStore } from "./evaluator";
import { andPreds, type GraphEvaluationEdge, type Predicate } from "./engine";
import type { GraphDocumentEdge, GraphDocumentNode } from "./records";
import { AUTHORED_GRAPH_OUTPUT_PORT, DERIVED_GRAPH_OUTPUT_PORT, type GraphPortValue } from "./values";

export interface GraphRuntimeNodeSpec {
  readonly type: string;
  readonly evaluationRole: "source" | "transform" | "view";
  readonly cook: GraphNodeCookFunction;
}

export interface GraphRuntimeNodeResolver {
  getSpec(type: string): GraphRuntimeNodeSpec | undefined;
}

export interface GraphRuntimeDocumentPort {
  node(id: string): GraphDocumentNode | undefined;
  edges(): readonly GraphDocumentEdge[];
}

export interface GraphRuntimeTopology {
  readonly nodes: Readonly<Record<string, GraphDocumentNode>>;
  readonly edges: Readonly<Record<string, GraphDocumentEdge>>;
  readonly flags: Readonly<Record<string, { bypass?: boolean }>>;
}

export type GraphNodeResolution =
  | { readonly status: "resolved"; readonly node: GraphDocumentNode }
  | { readonly status: "unresolved"; readonly node: GraphDocumentNode };

export type CheckpointInput =
  | Extract<GraphPortValue, { kind: "sel" }>
  | { readonly kind: "pred"; readonly sql: string | null };

export interface GraphRuntimeSessionOptions {
  readonly resolver: GraphRuntimeNodeResolver;
  readonly document: GraphRuntimeDocumentPort;
  readonly schedule?: (flush: () => void) => void;
  readonly onFlush?: () => void;
}

/**
 * Owns the live evaluator, authored values, sinks, and checkpoint snapshots for
 * one graph document. The document owner remains responsible for committing
 * topology and presentation state through its transaction facade.
 */
export class GraphRuntimeSession {
  private readonly resolver: GraphRuntimeNodeResolver;
  private readonly document: GraphRuntimeDocumentPort;
  private readonly evaluator: GraphEvaluator;
  private readonly registeredNodes = new Set<string>();
  private readonly frozenPredicates = new Map<string, Predicate>();
  private readonly frozenRows = new Map<string, RowIndex[] | null>();

  readonly telemetry: GraphEvaluationStore;

  constructor({ resolver, document, schedule, onFlush }: GraphRuntimeSessionOptions) {
    this.resolver = resolver;
    this.document = document;
    this.evaluator = new GraphEvaluator({
      schedule,
      passthrough: (inputs) => ({ kind: "pred", sql: andPreds(predicateSqls(inputs)) }),
      onFlush,
    });
    this.telemetry = this.evaluator.telemetry;
  }

  get epoch(): number {
    return this.evaluator.epoch;
  }

  isRegistered(id: string): boolean {
    return this.registeredNodes.has(id);
  }

  resolutionOf(node: GraphDocumentNode): GraphNodeResolution {
    return this.resolver.getSpec(node.type) ? { status: "resolved", node } : { status: "unresolved", node };
  }

  unresolvedNodes(nodes: Readonly<Record<string, GraphDocumentNode>>): readonly GraphDocumentNode[] {
    return Object.values(nodes).filter((node) => !this.resolver.getSpec(node.type));
  }

  registerNode(node: GraphDocumentNode): boolean {
    const spec = this.resolver.getSpec(node.type);
    if (!spec) return false;
    const host: GraphNodeCookHost = {
      id: node.id,
      node: () => this.document.node(node.id),
      frozenPredicate: () =>
        this.frozenPredicates.has(node.id) ? (this.frozenPredicates.get(node.id) ?? null) : undefined,
    };
    this.evaluator.addNode({
      id: node.id,
      kind: spec.evaluationRole,
      cook: (inputs, context) => spec.cook(inputs, host, context),
    });
    this.registeredNodes.add(node.id);
    return true;
  }

  removeNode(id: string): void {
    this.evaluator.removeNode(id);
    this.registeredNodes.delete(id);
    this.frozenPredicates.delete(id);
    this.frozenRows.delete(id);
  }

  canConnect(fromId: string, toId: string, nodes?: Readonly<Record<string, GraphDocumentNode>>): boolean {
    const endpoint = this.evaluationEndpoints(fromId, toId, nodes);
    return this.evaluator.canConnect(endpoint);
  }

  connect(edge: GraphDocumentEdge, nodes?: Readonly<Record<string, GraphDocumentNode>>): boolean {
    if (!this.edgeIsResolved(edge, nodes)) return false;
    return this.evaluator.connect(this.evaluationEdge(edge, nodes));
  }

  disconnect(edge: GraphDocumentEdge, nodes?: Readonly<Record<string, GraphDocumentNode>>): void {
    this.evaluator.disconnect(this.evaluationEdge(edge, nodes));
  }

  /** Register a fresh document before its one store commit. Unknown nodes and
   * incident evaluator edges stay inert while their document records survive. */
  load(topology: GraphRuntimeTopology): void {
    if (this.registeredNodes.size > 0) throw new Error("graph runtime session already has a document");
    const added: string[] = [];
    try {
      for (const node of Object.values(topology.nodes)) {
        if (this.registerNode(node)) added.push(node.id);
      }
      for (const node of Object.values(topology.nodes)) {
        if (node.type !== "subnet") continue;
        const seam: GraphEvaluationEdge = { from: `${node.id}-out`, to: node.id, toPort: "in" };
        if (this.registeredNodes.has(seam.from) && this.registeredNodes.has(seam.to) && !this.evaluator.connect(seam)) {
          throw new Error(`graph runtime rejected subnet seam for "${node.id}"`);
        }
      }
      for (const edge of Object.values(topology.edges)) {
        if (!this.edgeIsResolved(edge, topology.nodes)) continue;
        if (!this.evaluator.connect(this.evaluationEdge(edge, topology.nodes))) {
          throw new Error(`graph runtime rejected edge "${edge.id}"`);
        }
      }
      for (const [id, flags] of Object.entries(topology.flags)) {
        if (!flags?.bypass || !this.registeredNodes.has(id)) continue;
        this.evaluator.setBypass(id, true);
        if (topology.nodes[id]?.type === "subnet" && this.registeredNodes.has(`${id}-out`)) {
          this.evaluator.setBypass(`${id}-out`, true);
        }
      }
    } catch (error) {
      for (let index = added.length - 1; index >= 0; index -= 1) this.removeNode(added[index]);
      throw error;
    }
  }

  connectSubnetSeam(subnetId: string): boolean {
    return this.evaluator.connect({ from: `${subnetId}-out`, to: subnetId, toPort: "in" });
  }

  pull(id: string): GraphPortValue {
    return this.evaluator.pull(id);
  }

  registerSink(id: string, listener: (value: GraphPortValue) => void): () => void {
    return this.evaluator.registerSink(id, listener);
  }

  markDirty(id: string): void {
    this.evaluator.markDirty(id);
  }

  setBypass(id: string, enabled: boolean): void {
    this.evaluator.setBypass(id, enabled);
  }

  setTelemetryEnabled(enabled: boolean): void {
    this.evaluator.setTelemetryEnabled(enabled);
  }

  emitSelection(nodeId: string, sql: string | null, rowIds: readonly RowIndex[] | null = null): void {
    let ids = rowIds;
    if (!ids && sql) {
      const match = sql.match(/__row_index__\s+IN\s*\(([^)]+)\)/i);
      if (match) {
        ids = match[1]
          .split(",")
          .map((value) => rowIndex(Number(value.trim())))
          .filter((value) => Number.isFinite(value));
      }
    }
    this.evaluator.emit(nodeId, AUTHORED_GRAPH_OUTPUT_PORT, { kind: "sel", sql, rowIds: ids });
  }

  selection(nodeId: string): Extract<GraphPortValue, { kind: "sel" }> | undefined {
    const value = this.evaluator.getEmission(nodeId, AUTHORED_GRAPH_OUTPUT_PORT);
    return value?.kind === "sel" ? value : undefined;
  }

  emitFocus(nodeId: string, focusedRowIndex: RowIndex | null): void {
    this.evaluator.emit(nodeId, AUTHORED_GRAPH_OUTPUT_PORT, { kind: "focus", rowIndex: focusedRowIndex });
  }

  liveCheckpointInput(id: string): CheckpointInput | null {
    let selection: Extract<GraphPortValue, { kind: "sel" }> | undefined;
    const predicateInputs: Predicate[] = [];
    for (const edge of this.document.edges()) {
      if (edge.to !== id || !this.registeredNodes.has(edge.from)) continue;
      if (edge.kind === "sel") {
        const value = this.evaluator.getEmission(edge.from, AUTHORED_GRAPH_OUTPUT_PORT);
        if (value?.kind === "sel") selection = value;
      } else {
        predicateInputs.push(predicateSql(this.evaluator.pull(edge.from)));
      }
    }
    if (selection) return selection;
    const sql = andPreds(predicateInputs);
    return sql !== null || predicateInputs.length > 0 ? { kind: "pred", sql } : null;
  }

  pinCheckpoint(id: string): number | null {
    const live = this.liveCheckpointInput(id);
    if (!live) return null;
    const rows = live.kind === "sel" && live.rowIds ? [...live.rowIds] : null;
    const frozen = rows && rows.length > 0 ? `__row_index__ IN (${rows.join(", ")})` : live.sql;
    if (!frozen) return null;
    this.frozenPredicates.set(id, frozen);
    this.frozenRows.set(id, rows);
    this.evaluator.markDirty(id);
    return this.evaluator.epoch;
  }

  unpinCheckpoint(id: string): boolean {
    if (!this.frozenPredicates.delete(id)) return false;
    this.frozenRows.delete(id);
    this.evaluator.markDirty(id);
    return true;
  }

  isCheckpointPinned(id: string): boolean {
    return this.frozenPredicates.has(id);
  }

  checkpointRows(id: string): readonly RowIndex[] | null | undefined {
    return this.frozenRows.get(id);
  }

  patchNodeConfig(node: GraphDocumentNode, patch: Record<string, unknown>): GraphDocumentNode {
    return { ...node, config: patchNodeConfig(node, patch as Record<string, JsonValue>) };
  }

  dispose(): void {
    this.evaluator.dispose();
    this.registeredNodes.clear();
    this.frozenPredicates.clear();
    this.frozenRows.clear();
  }

  private edgeIsResolved(
    edge: Pick<GraphDocumentEdge, "from" | "to">,
    nodes?: Readonly<Record<string, GraphDocumentNode>>,
  ): boolean {
    const target = nodes?.[edge.to] ?? this.document.node(edge.to);
    const to = target?.type === "subnet" ? `${edge.to}-in` : edge.to;
    return this.registeredNodes.has(edge.from) && this.registeredNodes.has(to);
  }

  private evaluationEndpoints(
    fromId: string,
    toId: string,
    nodes?: Readonly<Record<string, GraphDocumentNode>>,
  ): { from: string; to: string } {
    const target = nodes?.[toId] ?? this.document.node(toId);
    return { from: fromId, to: target?.type === "subnet" ? `${toId}-in` : toId };
  }

  private evaluationEdge(
    edge: GraphDocumentEdge,
    nodes?: Readonly<Record<string, GraphDocumentNode>>,
  ): GraphEvaluationEdge {
    const endpoint = this.evaluationEndpoints(edge.from, edge.to, nodes);
    return {
      ...endpoint,
      fromPort: edge.kind === "pred" ? DERIVED_GRAPH_OUTPUT_PORT : AUTHORED_GRAPH_OUTPUT_PORT,
      toPort: edge.toPort,
    };
  }
}
