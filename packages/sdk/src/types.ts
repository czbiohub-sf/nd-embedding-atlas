/** Lazy plugin descriptor contract, independent of any layout engine. */

import type { ComponentType } from "react";
import type { ZodType } from "zod";
import type { DataCapability } from "@ndea/protocol";
import type { JsonValue } from "./json";
import type { OptionsBuilder, NodeContext, NodeHost, NodeSessionEvent } from "./host";

export type DescriptorKind = "view" | "transform";

export type PortKind = "pred" | "sel" | "focus";

export type FanInOp = "and" | "or" | "diff";

export interface NodePort {
  id: string;
  kind: PortKind;
  label: string;
  multiple?: boolean;
  fanIn?: FanInOp;
  doc?: string;
}

export type NodeCapability =
  | "read"
  | "selection-out"
  | "selection-in"
  | "schema-mutate"
  | "spatial"
  | "collections"
  | "gpu"
  | "wasm-bitmap"
  | "transform-compute"
  | "annotate"
  | "ordering";

export type MountReason = "fresh" | "restore" | "user-add" | "float" | "pip" | "graph-node";

export interface NodePlacement {
  container: "docked" | "slide" | "float";
  side?: "right" | "bottom";
  size?: { w: number; h: number };
}

export type InstancePolicy = "singleton" | "multi" | "unique-per-container";

/** Metadata shared by built-in and plugin-backed nodes. */
export interface NodeSpec {
  id: string;
  title: string;
  inputs: NodePort[];
  outputs: NodePort[];
  /** Runtime schema for serializable node configuration. */
  config?: ZodType;
  configVersion?: number;
}

export interface NodeDoc {
  summary: string;
  use: string;
  note?: string;
}

/** Side-effect-free metadata safe to enumerate without loading engine code. */
export interface NodeMeta extends NodeSpec {
  kind: DescriptorKind;
  capabilities: ReadonlySet<NodeCapability>;

  placement: NodePlacement;
  instancePolicy: InstancePolicy;

  maxInstances?: number;

  /** Dataset capabilities required before the node can be offered. */
  requires?: readonly DataCapability[];

  icon?: string;
  doc?: NodeDoc;

  /** Host API version, checked for major-version compatibility at registration. */
  sdkVersion?: string;
}

export interface NodeViewProps<Config = unknown, Options = unknown> {
  host: NodeHost<Config, Options>;
}

export interface NodeInstance {
  recompute?(inputs: ReadonlyMap<string, unknown>, ctx: NodeContext): void;
  onSession?(event: NodeSessionEvent, ctx: NodeContext): void;
  dispose(): void;
}

/** Lazily loaded render and engine implementation. */
export interface NodeModule<Config = unknown, Options = unknown> {
  Component: ComponentType<NodeViewProps<Config, Options>>;
  defaultConfig: Config & JsonValue;
  options?: (b: OptionsBuilder<Options>) => void;
  createInstance?: (host: NodeHost<Config, Options>) => NodeInstance;
}

export interface NodeDescriptor<Config = unknown, Options = unknown> extends NodeMeta {
  /** Must resolve to an in-tree chunk so compiled binaries remain self-contained. */
  load: () => Promise<NodeModule<Config, Options>>;
}
