import type { NodeCapability, NodeComputeContext, NodeComputeInputs } from "./node";
import type { NodeHost } from "./host";

export interface MountedNodeBody {
  readonly element: HTMLElement;
  /** Must be safe to call more than once. */
  dispose(): void;
}

/** Per-instance compute and lifecycle state. */
export interface NodeRuntime {
  recompute?(inputs: NodeComputeInputs, context: NodeComputeContext): void | Promise<void>;
  onSession?(event: "start" | "switch" | "shutdown", context: NodeComputeContext): void;
  dispose(): void;
}

/**
 * Lazy executable implementation. It repeats no static definition metadata and
 * is neutral to React, Web Components, Canvas, or any other UI framework.
 */
export interface NodeModule<Config = unknown, Capabilities extends NodeCapability = NodeCapability> {
  createRuntime?(host: NodeHost<Config, Capabilities>): NodeRuntime;
  mountBody?(host: NodeHost<Config, Capabilities>): MountedNodeBody | Promise<MountedNodeBody>;
}
