/** App-local runtime and presentation policy paired with one SDK node definition. */

import type { ComponentType } from "react";
import type { NodeCapability, NodeDefinition } from "@ndea/sdk";
import type { NdPortKind } from "@/components/nd/nd-port";
import type { GraphNodeCookFunction } from "@/core/graph/cook";
import type { GraphNodeRegistrationContext } from "@/core/graph/evaluator";
import type { GraphDocumentNode, GraphNodeRole, GraphNodeType } from "@/core/graph/records";
import type { CatalogNodeDefinition } from "@/core/plugin/registration";
import type { WorkspaceNodeSize } from "./types";

export interface WorkspaceNodeGeometry {
  readonly chipW: number;
  readonly card: WorkspaceNodeSize;
  readonly full: WorkspaceNodeSize;
  readonly canFull: boolean;
}

export interface NativeNodeContribution<
  Config = unknown,
  Capabilities extends readonly NodeCapability[] = readonly NodeCapability[],
> {
  /** Author-owned identity, ports, config, capabilities, module, and documentation. */
  readonly definition: NodeDefinition<Config, Capabilities>;
  /** App-owned graph evaluation and persisted-document compatibility. */
  readonly graph: {
    /** Only legacy graph identities that differ from the exact definition id set this. */
    readonly persistedType?: GraphNodeType;
    readonly role: GraphNodeRole;
    readonly evaluationRole: "source" | "transform" | "view";
    readonly cook: GraphNodeCookFunction;
    readonly registerEvaluation?: (context: GraphNodeRegistrationContext) => void;
    readonly Body?: ComponentType<{ node: GraphDocumentNode }>;
    /** Persist the definition id for bodies/runtimes loaded through the SDK contract. */
    readonly usesDefinitionModule?: boolean;
  };
  /** Canvas and Stage policy is deliberately outside the portable definition. */
  readonly workspace: {
    readonly geometry: WorkspaceNodeGeometry;
    readonly stage: "stageable" | "pin-only" | "canvas-only";
    readonly inPalette: boolean;
    readonly accent?: string;
    readonly checkpoint?: boolean;
  };
}

/** Existential contribution shape used only by heterogeneous native collections. */
// oxlint-disable-next-line no-explicit-any -- TypeScript has no existential generics; runtime catalog validation checks every erased contribution.
export type AnyNativeNodeContribution = NativeNodeContribution<any, any>;

export interface WorkspaceNodeSpec {
  readonly definition: CatalogNodeDefinition;
  readonly type: GraphNodeType;
  readonly kind: GraphNodeRole;
  readonly evaluationRole: "source" | "transform" | "view";
  readonly cook: GraphNodeCookFunction;
  readonly registerEvaluation?: (context: GraphNodeRegistrationContext) => void;
  readonly Body?: ComponentType<{ node: GraphDocumentNode }>;
  readonly pluginId: string | null;
  readonly geometry: WorkspaceNodeGeometry;
  readonly stage: "stageable" | "pin-only" | "canvas-only";
  readonly inPalette: boolean;
  readonly accent?: string;
  readonly checkpoint?: boolean;
}

export interface WorkspaceNodeDescriptor {
  readonly type: GraphNodeType;
  readonly kind: GraphNodeRole;
  readonly label: string;
  readonly pluginId: string | null;
  readonly chipW: number;
  readonly card: WorkspaceNodeSize;
  readonly full: WorkspaceNodeSize;
  readonly canFull: boolean;
  readonly hasIn: boolean;
  readonly hasOut: boolean;
  readonly outKind: NdPortKind;
  readonly inKinds: readonly NdPortKind[];
  readonly stage: "stageable" | "pin-only" | "canvas-only";
  readonly inPalette: boolean;
}

/** Immutable resolver injected into each Workspace; it owns no document or runtime state. */
export interface WorkspaceNodeLibrary {
  getSpec(type: string): WorkspaceNodeSpec | undefined;
  getDescriptor(type: string): WorkspaceNodeDescriptor | undefined;
}

function freezeGeometry(geometry: WorkspaceNodeGeometry): WorkspaceNodeGeometry {
  return Object.freeze({
    ...geometry,
    card: Object.freeze({ ...geometry.card }),
    full: Object.freeze({ ...geometry.full }),
  });
}

export function defineNativeNodeContribution<Config, Capabilities extends readonly NodeCapability[]>(
  contribution: NativeNodeContribution<Config, Capabilities>,
): NativeNodeContribution<Config, Capabilities> {
  return Object.freeze({
    definition: contribution.definition,
    graph: Object.freeze({ ...contribution.graph }),
    workspace: Object.freeze({
      ...contribution.workspace,
      geometry: freezeGeometry(contribution.workspace.geometry),
    }),
  });
}

export function workspaceNodeSpecOf(contribution: AnyNativeNodeContribution): WorkspaceNodeSpec {
  const type = (contribution.graph.persistedType ?? contribution.definition.ref.nodeTypeId) as GraphNodeType;
  return Object.freeze({
    definition: contribution.definition,
    type,
    kind: contribution.graph.role,
    evaluationRole: contribution.graph.evaluationRole,
    cook: contribution.graph.cook,
    registerEvaluation: contribution.graph.registerEvaluation,
    Body: contribution.graph.Body,
    pluginId: contribution.graph.usesDefinitionModule ? contribution.definition.ref.nodeTypeId : null,
    geometry: contribution.workspace.geometry,
    stage: contribution.workspace.stage,
    inPalette: contribution.workspace.inPalette,
    accent: contribution.workspace.accent,
    checkpoint: contribution.workspace.checkpoint,
  });
}

export function inputPortKindsOf(spec: WorkspaceNodeSpec): NdPortKind[] {
  return spec.definition.inputs.map((port) => port.kind as NdPortKind);
}

export function outputPortKindOf(spec: WorkspaceNodeSpec): NdPortKind {
  return (spec.definition.outputs[0]?.kind as NdPortKind) ?? "pred";
}

/** Validates persisted config against the author-owned definition contract. */
export function parseWorkspaceNodeConfig(
  spec: WorkspaceNodeSpec,
  raw: unknown,
): { ok: true; value: unknown } | { ok: false; error: string } {
  const schema = spec.definition.config?.schema;
  if (!schema) return { ok: true, value: raw };
  const result = schema.safeParse(raw);
  return result.success ? { ok: true, value: result.data } : { ok: false, error: result.error.message };
}
