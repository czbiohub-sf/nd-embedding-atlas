import {
  nodeConfigVersion,
  rowIndex,
  type ExactNodeTypeRef,
  type JsonValue,
  type PortKind,
  type RowIndex,
} from "@ndea/sdk";
import {
  instantiateNodeAssetExpansion,
  type InstantiatedNodeAssetExpansion,
  type NodeAssetExpansionDescriptor,
} from "@/core/node-asset/compiler";
import { nodeTypeRefForAsset } from "@/core/node-asset/library";
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
  readonly definition: {
    readonly ref: ExactNodeTypeRef;
    readonly inputs: readonly { readonly id: string; readonly kind: PortKind }[];
    readonly outputs: readonly { readonly id: string; readonly kind: PortKind }[];
    readonly config?: {
      readonly version: number;
      readonly defaultValue: unknown;
      readonly schema: { parse(value: unknown): unknown };
    };
  };
  readonly evaluationRole: "source" | "transform" | "view";
  readonly cook: GraphNodeCookFunction;
}

export interface GraphRuntimeNodeResolver {
  getSpecExact(ref: ExactNodeTypeRef): GraphRuntimeNodeSpec | undefined;
  getAssetExpansionExact?(ref: ExactNodeTypeRef): NodeAssetExpansionDescriptor | undefined;
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

/**
 * Validates the persisted graph without registering cooks or mutating runtime
 * state. Unknown definitions deliberately cut the resolved graph: their
 * incident wires remain opaque document records until the definition returns.
 */
export function validateGraphRuntimeTopology(topology: GraphRuntimeTopology, resolver: GraphRuntimeNodeResolver): void {
  const specs = new Map<string, GraphRuntimeNodeSpec>();
  for (const node of Object.values(topology.nodes)) {
    const spec = resolver.getSpecExact(node.definitionRef);
    if (spec) specs.set(node.id, spec);
  }

  for (const edge of Object.values(topology.edges)) {
    if (!topology.nodes[edge.from]) throw new Error(`edge "${edge.id}" references missing node "${edge.from}"`);
    if (!topology.nodes[edge.to]) throw new Error(`edge "${edge.id}" references missing node "${edge.to}"`);
  }

  const adjacency = new Map<string, Set<string>>();
  for (const id of specs.keys()) adjacency.set(id, new Set());
  const reaches = (from: string, target: string): boolean => {
    const pending = [from];
    const visited = new Set<string>();
    while (pending.length > 0) {
      const current = pending.pop()!;
      if (current === target) return true;
      if (visited.has(current)) continue;
      visited.add(current);
      for (const next of adjacency.get(current) ?? []) pending.push(next);
    }
    return false;
  };
  const connect = (from: string, to: string, errorMessage: string): void => {
    if (!adjacency.has(from) || !adjacency.has(to) || from === to || reaches(to, from)) {
      throw new Error(errorMessage);
    }
    adjacency.get(from)!.add(to);
  };

  for (const node of Object.values(topology.nodes)) {
    if (node.definitionRef.nodeTypeId !== "subnet" || !specs.has(node.id)) continue;
    const outputProxyId = `${node.id}-out`;
    if (specs.has(outputProxyId)) {
      connect(outputProxyId, node.id, `graph runtime rejected subnet seam for "${node.id}"`);
    }
  }

  const resolvedWires = new Set<string>();
  for (const edge of Object.values(topology.edges)) {
    const source = specs.get(edge.from);
    const target = specs.get(edge.to);
    if (!source || !target) continue;

    const output = source.definition.outputs.find((port) => port.id === edge.fromPort);
    if (!output) throw new Error(`edge "${edge.id}" references undeclared output port "${edge.fromPort}"`);
    if (output.kind !== edge.kind) {
      throw new Error(
        `edge "${edge.id}" kind "${edge.kind}" is incompatible with output port "${edge.fromPort}" kind "${output.kind}"`,
      );
    }
    const input = target.definition.inputs.find((port) => port.id === edge.toPort);
    if (!input) throw new Error(`edge "${edge.id}" targets undeclared input port "${edge.toPort}"`);
    if (input.kind !== edge.kind) {
      throw new Error(
        `edge "${edge.id}" kind "${edge.kind}" is incompatible with input port "${edge.toPort}" kind "${input.kind}"`,
      );
    }

    const wireKey = `${edge.from}\u0000${edge.fromPort}\u0000${edge.to}\u0000${edge.toPort}`;
    if (resolvedWires.has(wireKey)) {
      throw new Error(
        `graph topology duplicates resolved wire "${edge.from}:${edge.fromPort}" -> "${edge.to}:${edge.toPort}"`,
      );
    }
    resolvedWires.add(wireKey);

    const evaluationTarget = target.definition.ref.nodeTypeId === "subnet" ? `${edge.to}-in` : edge.to;
    if (!specs.has(evaluationTarget)) {
      throw new Error(`edge "${edge.id}" has no resolved runtime endpoint "${evaluationTarget}"`);
    }
    connect(edge.from, evaluationTarget, `graph runtime rejected edge "${edge.id}"`);
  }
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

interface AssetSinkRegistration {
  readonly listener: (value: GraphPortValue) => void;
  dispose: () => void;
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
  private readonly pendingNodes = new Map<string, GraphDocumentNode>();
  private readonly runtimeNodes = new Map<string, GraphDocumentNode>();
  private readonly assetExpansions = new Map<string, InstantiatedNodeAssetExpansion>();
  private readonly assetSinks = new Map<string, AssetSinkRegistration>();

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
    return this.resolver.getSpecExact(node.definitionRef)
      ? { status: "resolved", node }
      : { status: "unresolved", node };
  }

  unresolvedNodes(nodes: Readonly<Record<string, GraphDocumentNode>>): readonly GraphDocumentNode[] {
    return Object.values(nodes).filter((node) => !this.resolver.getSpecExact(node.definitionRef));
  }

  registerNode(node: GraphDocumentNode): boolean {
    const spec = this.resolver.getSpecExact(node.definitionRef);
    if (!spec) return false;
    const expansion = this.resolver.getAssetExpansionExact?.(node.definitionRef);
    if (expansion) {
      this.assertExpansionAcyclic(expansion, []);
      const added: string[] = [];
      try {
        this.registerAssetExpansion(node, expansion, added);
        return true;
      } catch (error) {
        if (this.registeredNodes.has(node.id)) this.removeNode(node.id, true);
        else for (let index = added.length - 1; index >= 0; index -= 1) this.removeRuntimeNode(added[index]);
        throw error;
      }
    }
    this.registerRuntimeNode(node, spec);
    return true;
  }

  private registerRuntimeNode(node: GraphDocumentNode, spec: GraphRuntimeNodeSpec): void {
    const host: GraphNodeCookHost = {
      id: node.id,
      node: () => this.pendingNodes.get(node.id) ?? this.runtimeNodes.get(node.id) ?? this.document.node(node.id),
      frozenPredicate: () =>
        this.frozenPredicates.has(node.id) ? (this.frozenPredicates.get(node.id) ?? null) : undefined,
    };
    this.evaluator.addNode({
      id: node.id,
      kind: spec.evaluationRole,
      cook: (inputs, context) => spec.cook(inputs, host, context),
    });
    this.registeredNodes.add(node.id);
    this.runtimeNodes.set(node.id, node);
  }

  removeNode(id: string, preserveSink = false): void {
    if (!preserveSink) this.clearAssetSink(id);
    const expansion = this.assetExpansions.get(id);
    if (expansion) {
      for (const node of expansion.nodes) {
        if (this.assetExpansions.has(node.id)) this.removeNode(node.id, preserveSink);
        else this.removeRuntimeNode(node.id);
      }
      this.assetExpansions.delete(id);
      this.registeredNodes.delete(id);
      return;
    }
    this.removeRuntimeNode(id);
  }

  private removeRuntimeNode(id: string): void {
    this.evaluator.removeNode(id);
    this.registeredNodes.delete(id);
    this.runtimeNodes.delete(id);
    this.frozenPredicates.delete(id);
    this.frozenRows.delete(id);
  }

  private registerAssetExpansion(
    outer: GraphDocumentNode,
    descriptor: NodeAssetExpansionDescriptor,
    added: string[],
  ): void {
    const parameters = outer.config?.value ?? {};
    const expansion = instantiateNodeAssetExpansion(descriptor, outer.id, parameters);
    this.assetExpansions.set(outer.id, expansion);
    this.registeredNodes.add(outer.id);
    for (const expanded of expansion.nodes) {
      const nested = expanded.boundary ? undefined : this.resolver.getAssetExpansionExact?.(expanded.definitionRef);
      if (nested) {
        this.registerAssetExpansion(expanded, nested, added);
        continue;
      }
      this.registerRuntimeNode(expanded, expanded.runtimeSpec);
      added.push(expanded.id);
    }
    for (const edge of expansion.edges) {
      if (!this.evaluator.connect(this.evaluationEdge(edge))) {
        throw new Error(`graph runtime rejected expanded edge "${edge.id}"`);
      }
    }
  }

  private assertExpansionAcyclic(descriptor: NodeAssetExpansionDescriptor, trace: readonly string[]): void {
    const key = `${descriptor.definition.assetId}@${descriptor.definition.assetVersion}`;
    const cycleAt = trace.indexOf(key);
    if (cycleAt >= 0) {
      throw new Error(`recursive node asset expansion: ${[...trace.slice(cycleAt), key].join(" -> ")}`);
    }
    for (const dependency of descriptor.definition.dependencies) {
      if (dependency.kind !== "asset") continue;
      const nested = this.resolver.getAssetExpansionExact?.(nodeTypeRefForAsset(dependency.assetRef));
      if (!nested) {
        throw new Error(
          `node asset expansion dependency "${dependency.assetRef.assetId}@${dependency.assetRef.assetVersion}" is unavailable`,
        );
      }
      this.assertExpansionAcyclic(nested, [...trace, key]);
    }
  }

  canConnect(
    fromId: string,
    toId: string,
    nodes?: Readonly<Record<string, GraphDocumentNode>>,
    fromPort = "out",
    toPort = "in",
  ): boolean {
    const endpoint = this.evaluationEndpoints(fromId, toId, nodes, fromPort, toPort);
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
    validateGraphRuntimeTopology(topology, this.resolver);
    const added: string[] = [];
    try {
      for (const node of Object.values(topology.nodes)) {
        if (this.registerNode(node)) added.push(node.id);
      }
      for (const node of Object.values(topology.nodes)) {
        if (node.definitionRef.nodeTypeId !== "subnet") continue;
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
        if (topology.nodes[id]?.definitionRef.nodeTypeId === "subnet" && this.registeredNodes.has(`${id}-out`)) {
          this.evaluator.setBypass(`${id}-out`, true);
        }
      }
    } catch (error) {
      for (let index = added.length - 1; index >= 0; index -= 1) this.removeNode(added[index]);
      throw error;
    }
  }

  /** Reconciles asset expansions and definitions that returned after document load. */
  refreshResolutions(topology: GraphRuntimeTopology): void {
    validateGraphRuntimeTopology(topology, this.resolver);
    const rebuild = Object.values(topology.nodes)
      .filter((node) => this.registeredNodes.has(node.id) && this.assetExpansions.has(node.id))
      .map((node) => node.id);
    for (const id of rebuild.toReversed()) this.removeNode(id, true);
    const added: string[] = [];
    try {
      for (const node of Object.values(topology.nodes)) {
        if (this.registeredNodes.has(node.id) || !this.registerNode(node)) continue;
        added.push(node.id);
      }
      const addedSet = new Set(added);
      for (const edge of Object.values(topology.edges)) {
        if (!addedSet.has(edge.from) && !addedSet.has(edge.to)) continue;
        if (!this.edgeIsResolved(edge, topology.nodes)) continue;
        if (!this.evaluator.connect(this.evaluationEdge(edge, topology.nodes))) {
          throw new Error(`graph runtime rejected restored edge "${edge.id}"`);
        }
      }
      for (const id of added) {
        if (!topology.flags[id]?.bypass) continue;
        this.setBypass(id, true);
      }
      for (const id of added) this.rebindAssetSink(id);
    } catch (error) {
      for (let index = added.length - 1; index >= 0; index -= 1) this.removeNode(added[index], true);
      throw error;
    }
  }

  connectSubnetSeam(subnetId: string): boolean {
    return this.evaluator.connect({ from: `${subnetId}-out`, to: subnetId, toPort: "in" });
  }

  pull(id: string): GraphPortValue {
    return this.evaluator.pull(this.primaryOutputNodeId(id));
  }

  registerSink(id: string, listener: (value: GraphPortValue) => void): () => void {
    if (!this.assetExpansions.has(id)) return this.evaluator.registerSink(id, listener);
    this.clearAssetSink(id);
    const registration: AssetSinkRegistration = {
      listener,
      dispose: this.evaluator.registerSink(this.primaryOutputNodeId(id), listener),
    };
    this.assetSinks.set(id, registration);
    return () => {
      if (this.assetSinks.get(id) !== registration) return;
      registration.dispose();
      this.assetSinks.delete(id);
    };
  }

  markDirty(id: string): void {
    const expansion = this.assetExpansions.get(id);
    if (!expansion) {
      this.evaluator.markDirty(id);
      return;
    }
    for (const node of expansion.nodes) this.markDirty(node.id);
  }

  recookNode(node: GraphDocumentNode): void {
    if (this.assetExpansions.has(node.id)) {
      const previous = this.document.node(node.id);
      if (!previous) throw new Error(`node "${node.id}" is unavailable`);
      const incident = this.document.edges().filter((edge) => edge.from === node.id || edge.to === node.id);
      this.removeNode(node.id, true);
      try {
        this.registerNode(node);
        for (const edge of incident) {
          if (!this.edgeIsResolved(edge)) continue;
          if (!this.connect(edge)) throw new Error(`graph runtime rejected restored edge "${edge.id}"`);
        }
        this.rebindAssetSink(node.id);
      } catch (error) {
        if (this.registeredNodes.has(node.id)) this.removeNode(node.id, true);
        this.registerNode(previous);
        for (const edge of incident) {
          if (this.edgeIsResolved(edge)) this.connect(edge);
        }
        this.rebindAssetSink(node.id);
        throw error;
      }
      return;
    }
    this.pendingNodes.set(node.id, node);
    try {
      this.evaluator.markDirty(node.id);
    } finally {
      this.pendingNodes.delete(node.id);
    }
  }

  setBypass(id: string, enabled: boolean): void {
    const expansion = this.assetExpansions.get(id);
    if (!expansion) {
      this.evaluator.setBypass(id, enabled);
      return;
    }
    for (const node of expansion.nodes) {
      if (this.assetExpansions.has(node.id)) this.setBypass(node.id, enabled);
      else this.evaluator.setBypass(node.id, enabled);
    }
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
      const sourceId = this.outputNodeId(edge.from, edge.fromPort);
      if (edge.kind === "sel") {
        const value = this.evaluator.getEmission(sourceId, AUTHORED_GRAPH_OUTPUT_PORT) ?? this.evaluator.pull(sourceId);
        if (value?.kind === "sel") selection = value;
      } else {
        predicateInputs.push(predicateSql(this.evaluator.pull(sourceId)));
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
    const contract = this.resolver.getSpecExact(node.definitionRef)?.definition.config;
    if (!contract) throw new Error(`node "${node.id}" does not accept configuration`);
    const patched = patchNodeConfig(node, patch as Record<string, JsonValue>);
    const defaultValue = contract.defaultValue;
    const candidate =
      defaultValue !== null &&
      typeof defaultValue === "object" &&
      !Array.isArray(defaultValue) &&
      patched &&
      typeof patched === "object" &&
      !Array.isArray(patched)
        ? { ...defaultValue, ...patched }
        : patched;
    const value = contract.schema.parse(candidate) as JsonValue;
    return {
      ...node,
      config: { version: nodeConfigVersion(contract.version), value },
    };
  }

  dispose(): void {
    for (const registration of this.assetSinks.values()) registration.dispose();
    this.assetSinks.clear();
    this.evaluator.dispose();
    this.registeredNodes.clear();
    this.runtimeNodes.clear();
    this.assetExpansions.clear();
    this.frozenPredicates.clear();
    this.frozenRows.clear();
    this.pendingNodes.clear();
  }

  private edgeIsResolved(
    edge: Pick<GraphDocumentEdge, "from" | "to">,
    nodes?: Readonly<Record<string, GraphDocumentNode>>,
  ): boolean {
    const target = nodes?.[edge.to] ?? this.document.node(edge.to);
    const to = target?.definitionRef.nodeTypeId === "subnet" ? `${edge.to}-in` : edge.to;
    return this.registeredNodes.has(edge.from) && this.registeredNodes.has(to);
  }

  private evaluationEndpoints(
    fromId: string,
    toId: string,
    nodes?: Readonly<Record<string, GraphDocumentNode>>,
    fromPort = "out",
    toPort = "in",
  ): { from: string; to: string } {
    const sourceExpansion = this.assetExpansions.get(fromId);
    const source = sourceExpansion
      ? (sourceExpansion.outputNodeIds[fromPort] ?? Object.values(sourceExpansion.outputNodeIds)[0] ?? fromId)
      : fromId;
    const targetExpansion = this.assetExpansions.get(toId);
    if (targetExpansion) {
      return { from: source, to: targetExpansion.inputNodeIds[toPort] ?? toId };
    }
    const target = nodes?.[toId] ?? this.document.node(toId);
    return { from: source, to: target?.definitionRef.nodeTypeId === "subnet" ? `${toId}-in` : toId };
  }

  private evaluationEdge(
    edge: GraphDocumentEdge,
    nodes?: Readonly<Record<string, GraphDocumentNode>>,
  ): GraphEvaluationEdge {
    const sourceIsAsset = this.assetExpansions.has(edge.from);
    const endpoint = this.evaluationEndpoints(edge.from, edge.to, nodes, edge.fromPort, edge.toPort);
    return {
      ...endpoint,
      fromPort: sourceIsAsset || edge.kind === "pred" ? DERIVED_GRAPH_OUTPUT_PORT : AUTHORED_GRAPH_OUTPUT_PORT,
      toPort: this.assetExpansions.has(edge.to) ? "in" : edge.toPort,
    };
  }

  private primaryOutputNodeId(id: string): string {
    return this.outputNodeId(id);
  }

  private outputNodeId(id: string, portId?: string): string {
    const expansion = this.assetExpansions.get(id);
    return expansion
      ? ((portId ? expansion.outputNodeIds[portId] : undefined) ?? Object.values(expansion.outputNodeIds)[0] ?? id)
      : id;
  }

  private rebindAssetSink(id: string): void {
    const registration = this.assetSinks.get(id);
    if (!registration) return;
    registration.dispose();
    registration.dispose = this.evaluator.registerSink(this.primaryOutputNodeId(id), registration.listener);
  }

  private clearAssetSink(id: string): void {
    const registration = this.assetSinks.get(id);
    if (!registration) return;
    registration.dispose();
    this.assetSinks.delete(id);
  }
}
