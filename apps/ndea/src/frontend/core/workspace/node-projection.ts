import type { NdPortKind } from "@/components/nd/nd-port";
import {
  adaptNodeCompute,
  type GraphNodeCookFunction,
  type GraphNodeCookHost,
  type GraphPortValueInputs,
} from "@/core/graph/cook";
import type { GraphNodeRole, GraphNodeType } from "@/core/graph/records";
import type { NativeNodeGeometry, AnyNativeNodeContribution } from "@/core/node/native-contribution";
import type { NodeCatalog } from "@/core/plugin/catalog";
import type { CatalogNodeDefinition } from "@/core/plugin/registration";
import type { NodeComputeContext } from "@ndea/sdk";

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
  listSpecs(): readonly WorkspaceNodeSpec[];
  listDescriptors(): readonly WorkspaceNodeDescriptor[];
  paletteDescriptors(): readonly WorkspaceNodeDescriptor[];
}

export function workspaceNodeSpecOf(contribution: AnyNativeNodeContribution): WorkspaceNodeSpec {
  const type: GraphNodeType = contribution.graph.persistedType ?? contribution.definition.ref.nodeTypeId;
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

/**
 * Rejects portable definitions that the current single-output synchronous
 * Workspace evaluator cannot represent. The caller performs this check while
 * collecting a source batch so one unsafe definition rejects that source
 * atomically.
 */
export function assertExternalDefinitionWorkspaceSafe(definition: CatalogNodeDefinition): void {
  const id = definition.ref.nodeTypeId;
  if (!definition.evaluate) throw new Error(`node "${id}" requires evaluate for Workspace registration`);
  if (definition.outputs.length !== 1) {
    throw new Error(`node "${id}" requires exactly one output for Workspace registration`);
  }
}

/** Derives generic product policy only after the external definition is validated and cataloged. */
export function externalWorkspaceNodeSpecOf(definition: CatalogNodeDefinition): WorkspaceNodeSpec {
  assertExternalDefinitionWorkspaceSafe(definition);
  const output = definition.outputs[0];
  const compute = adaptNodeCompute(definition.evaluate!, output.id, output.kind);
  const preferredSize = definition.presentation?.preferredBodySize;
  const defaultSize = definition.role === "view" ? { width: 420, height: 320 } : { width: 240, height: 160 };
  const width = preferredSize?.width ?? defaultSize.width;
  const height = preferredSize?.height ?? defaultSize.height;
  const geometry: NativeNodeGeometry = Object.freeze({
    chipW: 148,
    card: Object.freeze({ w: width, h: height }),
    full: Object.freeze({ w: width, h: height }),
    canFull: definition.load !== undefined,
  });
  const role: GraphNodeRole =
    definition.role === "view" ? "view" : definition.inputs.length === 0 ? "source" : "transform";

  return Object.freeze({
    definition,
    type: definition.ref.nodeTypeId,
    kind: role,
    evaluationRole: role,
    cook: (inputs: GraphPortValueInputs, _host: GraphNodeCookHost, context?: NodeComputeContext) => {
      if (!context) throw new Error(`node "${definition.ref.nodeTypeId}" requires a compute context`);
      return compute(inputs, context);
    },
    pluginId: definition.load ? definition.ref.nodeTypeId : null,
    geometry,
    ...(definition.load ? { body: "full-only" as const } : {}),
    stage: definition.load ? "stageable" : "canvas-only",
    inPalette: true,
  });
}

export function inputPortKindsOf(spec: WorkspaceNodeSpec): NdPortKind[] {
  return spec.definition.inputs.map((port) => port.kind as NdPortKind);
}

export function outputPortKindOf(spec: WorkspaceNodeSpec): NdPortKind {
  return (spec.definition.outputs[0]?.kind as NdPortKind) ?? "pred";
}

export function workspaceNodeDescriptorOf(spec: WorkspaceNodeSpec): WorkspaceNodeDescriptor {
  return Object.freeze({
    type: spec.type,
    kind: spec.kind,
    label: spec.definition.title,
    pluginId: spec.pluginId,
    chipW: spec.geometry.chipW,
    card: spec.geometry.card,
    full: spec.geometry.full,
    canFull: spec.geometry.canFull,
    hasIn: spec.definition.inputs.length > 0,
    hasOut: spec.definition.outputs.length > 0,
    outKind: outputPortKindOf(spec),
    inKinds: Object.freeze(inputPortKindsOf(spec)),
    stage: spec.stage,
    inPalette: spec.inPalette,
  });
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
