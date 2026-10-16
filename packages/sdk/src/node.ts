import type { ZodType } from "zod";
import type { NodeModule } from "./module";

declare const NODE_TYPE_ID: unique symbol;
declare const NODE_TYPE_VERSION: unique symbol;
declare const NODE_INSTANCE_ID: unique symbol;

export type NodeTypeId = string & { readonly [NODE_TYPE_ID]: true };
export type NodeTypeVersion = string & { readonly [NODE_TYPE_VERSION]: true };
export type NodeInstanceId = string & { readonly [NODE_INSTANCE_ID]: true };

declare const ROW_INDEX: unique symbol;

export type RowIndex = number & { readonly [ROW_INDEX]: true };

export function rowIndex(value: number): RowIndex {
  return value as RowIndex;
}

export function nodeTypeId(value: string): NodeTypeId {
  return value as NodeTypeId;
}

export function nodeTypeVersion(value: string): NodeTypeVersion {
  return value as NodeTypeVersion;
}

export function nodeInstanceId(value: string): NodeInstanceId {
  return value as NodeInstanceId;
}

export interface ExactNodeTypeRef {
  readonly nodeTypeId: NodeTypeId;
  readonly nodeTypeVersion: NodeTypeVersion;
}

export function exactNodeTypeRef(nodeType: string, version: string): ExactNodeTypeRef {
  return {
    nodeTypeId: nodeTypeId(nodeType),
    nodeTypeVersion: nodeTypeVersion(version),
  };
}

export interface NodeConfigContract<Config = unknown> {
  readonly schema: ZodType<Config>;
  readonly defaultValue: Config;
}

export type NodeCapability =
  | "data-read"
  | "row-set-publish"
  | "focus-coordination"
  | "view-coordination"
  | "schema-mutation"
  | "spatial-data"
  | "gpu-device"
  | "wasm-bitmap"
  | "compute"
  | "annotation-write"
  | "ordering-coordination"
  | "filter-coordination"
  | "color-coordination";

export interface NodeDocumentation {
  readonly summary: string;
  readonly use: string;
  readonly note?: string;
}

/** Portable author hints only. Canvas, Stage, and product layout policy stay app-local. */
export interface NodePresentationHints {
  readonly icon?: string;
  readonly preferredBodySize?: {
    readonly width: number;
    readonly height: number;
  };
}

/**
 * The single author-owned contract for one exact node type.
 *
 * Catalog provenance, product placement, graph records, and live instances are
 * deliberately absent. A host may add those concerns without copying fields.
 */
export interface NodeDefinition<
  Config = unknown,
  Capabilities extends readonly NodeCapability[] = readonly NodeCapability[],
> {
  readonly ref: ExactNodeTypeRef;
  readonly title: string;
  readonly capabilities: Capabilities;
  readonly config?: NodeConfigContract<Config>;
  readonly load?: () => Promise<NodeModule<Config, Capabilities[number]>>;
  readonly documentation?: NodeDocumentation;
  readonly presentation?: NodePresentationHints;
}

export function defineNode<Config, const Capabilities extends readonly NodeCapability[]>(
  definition: NodeDefinition<Config, Capabilities>,
): NodeDefinition<Config, Capabilities> {
  return definition;
}
