import type { CoordinationScopeCellPort } from "@/core/coordination/coordination";
import type { GraphEvaluationState, GraphPortValue } from "@ndea/graph";
import type { GraphDocumentNode } from "@/core/graph/records";

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

/** Narrow command and observation surface consumed by the node runtime manager. */
export interface NodeRuntimeSessionPort {
  readonly store: NodeRuntimeDocumentStore;
  readonly telemetry: NodeRuntimeTelemetryStore;
  readonly coordination: CoordinationScopeCellPort;
  updateNodeConfig(nodeId: string, patch: Record<string, unknown>): void;
  registerGraphSink(nodeId: string, listener: (value: GraphPortValue) => void): () => void;
  enterSubnet(nodeId: string): void;
}
