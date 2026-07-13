import type { RowIndex } from "@ndea/sdk";
import type { CoordinationScopeCellPort } from "@/core/coordination/coordination";
import type { GraphEvaluationState } from "@/core/graph/evaluator";
import type { CheckpointInput } from "@/core/graph/runtime-session";
import type { GraphDocumentNode } from "@/core/graph/records";
import type { GraphPortValue } from "@/core/graph/values";

export interface NodeRuntimeDocumentState {
  readonly nodes: Readonly<Record<string, GraphDocumentNode>>;
  readonly flags: Readonly<Record<string, { bypass?: boolean; off?: boolean }>>;
}

export interface NodeRuntimeDocumentStore {
  readonly state: NodeRuntimeDocumentState;
  subscribe(listener: () => void): { unsubscribe(): void };
}

export interface NodeRuntimeTelemetryStore {
  readonly state: GraphEvaluationState;
  subscribe(listener: () => void): { unsubscribe(): void };
}

/** Narrow command and observation surface consumed by the U18 runtime manager. */
export interface NodeRuntimeSessionPort {
  readonly store: NodeRuntimeDocumentStore;
  readonly telemetry: NodeRuntimeTelemetryStore;
  readonly coordination: CoordinationScopeCellPort;
  updateNodeConfig(nodeId: string, patch: Record<string, unknown>): void;
  getLasso(nodeId: string): Extract<GraphPortValue, { kind: "sel" }> | undefined;
  emitLasso(nodeId: string, sql: string | null, rowIds?: readonly RowIndex[] | null): void;
  emitFocus(nodeId: string, focusedRowIndex: RowIndex | null): void;
  registerGraphSink(nodeId: string, listener: (value: GraphPortValue) => void): () => void;
  liveCacheInput(nodeId: string): CheckpointInput | null;
  isCached(nodeId: string): boolean;
  pinCache(nodeId: string): boolean;
  uncache(nodeId: string): void;
  freezeSelection(nodeId: string): string | null;
  enterSubnet(nodeId: string): void;
}
