import type { NodeCapability } from "./node";
import type { NodeHost } from "./host";

export interface MountedNodeBody {
  readonly element: HTMLElement;
  /** Must be safe to call more than once. */
  dispose(): void;
}

/** Per-instance lifecycle state. */
export interface NodeRuntime {
  dispose(): void;
}

/**
 * Lazy executable implementation. It repeats no static definition metadata and
 * is neutral to React, Web Components, Canvas, or any other UI framework.
 */
export interface NodeModule<Config = unknown, Capabilities extends NodeCapability = never> {
  createRuntime?(host: NodeHost<Config, Capabilities>): NodeRuntime;
  mountBody?(host: NodeHost<Config, Capabilities>): MountedNodeBody | Promise<MountedNodeBody>;
}
