import type { NdPortKind } from "@/components/nd/nd-port";
import type { GraphNodeCookFunction } from "@/core/graph/cook";
import type { GraphNodeRole, GraphNodeType } from "@/core/graph/records";
import type { NativeNodeGeometry, AnyNativeNodeContribution } from "@/core/node/native-contribution";
import type { NodeCatalog } from "@/core/plugin/catalog";
import type { CatalogNodeDefinition } from "@/core/plugin/registration";

export interface WorkspaceNodeSpec {
  readonly definition: CatalogNodeDefinition;
  readonly type: GraphNodeType;
  readonly kind: GraphNodeRole;
  readonly evaluationRole: "source" | "transform" | "view";
  readonly cook: GraphNodeCookFunction;
  /** Persisted module identity for definitions that own a runtime or Body. */
  readonly pluginId: string | null;
  readonly geometry: NativeNodeGeometry;
  readonly body?: "card-and-full" | "full-only";
  readonly stage: "stageable" | "pin-only" | "canvas-only";
  readonly inPalette: boolean;
  readonly accent?: string;
  readonly checkpoint?: boolean;
  readonly checkpointCreation?: boolean;
}

export interface WorkspaceNodeDescriptor {
  readonly type: GraphNodeType;
  readonly kind: GraphNodeRole;
  readonly label: string;
  readonly pluginId: string | null;
  readonly chipW: number;
  readonly card: NativeNodeGeometry["card"];
  readonly full: NativeNodeGeometry["full"];
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
  readonly catalog: NodeCatalog;
  getSpec(type: string): WorkspaceNodeSpec | undefined;
  getDescriptor(type: string): WorkspaceNodeDescriptor | undefined;
}

export function workspaceNodeSpecOf(contribution: AnyNativeNodeContribution): WorkspaceNodeSpec {
  const type = (contribution.graph.persistedType ?? contribution.definition.ref.nodeTypeId) as GraphNodeType;
  return Object.freeze({
    definition: contribution.definition,
    type,
    kind: contribution.graph.role,
    evaluationRole: contribution.graph.evaluationRole,
    cook: contribution.graph.cook,
    pluginId: contribution.definition.load ? contribution.definition.ref.nodeTypeId : null,
    geometry: contribution.presentation.geometry,
    body: contribution.presentation.body,
    stage: contribution.presentation.stage,
    inPalette: contribution.presentation.inPalette,
    accent: contribution.presentation.accent,
    checkpoint: contribution.presentation.checkpoint,
    checkpointCreation: contribution.presentation.checkpointCreation,
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
