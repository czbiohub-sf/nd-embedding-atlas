import type { NdPortKind } from "@/components/nd/nd-port";
import {
  adaptNodeCompute,
  type GraphNodeCookFunction,
  type GraphNodeCookHost,
  type GraphPortValueInputs,
} from "@/core/graph/cook";
import type { GraphNodeRole, GraphNodeType } from "@/core/graph/records";
import { createNodeCatalog, type NodeCatalog } from "@/core/plugin/catalog";
import { NATIVE_NODE_SOURCE } from "@/core/plugin/registration";
import type { NativeNodeGeometry, AnyNativeNodeContribution } from "./native-contribution";
import { NATIVE_NODE_CONTRIBUTIONS, NATIVE_NODE_DEFINITIONS } from "./native-nodes";
import type { CatalogNodeDefinition } from "@/core/plugin/registration";
import type { ExactNodeTypeRef, NodeComputeContext, PluginFactory } from "@ndea/sdk";

export interface AppNodeSpec {
  readonly definition: CatalogNodeDefinition;
  readonly type: GraphNodeType;
  readonly kind: GraphNodeRole;
  readonly evaluationRole: "source" | "transform" | "view";
  readonly cook: GraphNodeCookFunction;
  readonly pluginId: string | null;
  readonly geometry: NativeNodeGeometry;
  readonly body?: "card-and-full" | "full-only";
  readonly stage: "stageable" | "pin-only" | "canvas-only";
  readonly inPalette: boolean;
  readonly accent?: string;
  readonly checkpoint?: boolean;
  readonly checkpointCreation?: boolean;
}

export interface AppNodeDescriptor {
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

/** Immutable session projection of the one frozen node catalog. */
export interface AppNodeLibrary {
  readonly catalog: NodeCatalog;
  getSpec(type: string): AppNodeSpec | undefined;
  getDescriptor(type: string): AppNodeDescriptor | undefined;
  listSpecs(): readonly AppNodeSpec[];
  listDescriptors(): readonly AppNodeDescriptor[];
  paletteDescriptors(): readonly AppNodeDescriptor[];
}

export function nativeNodeSpecOf(contribution: AnyNativeNodeContribution): AppNodeSpec {
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

export function assertExternalDefinitionGraphSafe(definition: CatalogNodeDefinition): void {
  const id = definition.ref.nodeTypeId;
  if (!definition.evaluate) throw new Error(`node "${id}" requires evaluate for graph registration`);
  if (definition.outputs.length !== 1) {
    throw new Error(`node "${id}" requires exactly one output for graph registration`);
  }
}

export function externalNodeSpecOf(definition: CatalogNodeDefinition): AppNodeSpec {
  assertExternalDefinitionGraphSafe(definition);
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

export function inputPortKindsOf(spec: AppNodeSpec): NdPortKind[] {
  return spec.definition.inputs.map((port) => port.kind as NdPortKind);
}

export function outputPortKindOf(spec: AppNodeSpec): NdPortKind {
  return (spec.definition.outputs[0]?.kind as NdPortKind) ?? "pred";
}

export function nodeDescriptorOf(spec: AppNodeSpec): AppNodeDescriptor {
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

export function parseNodeConfig(
  spec: AppNodeSpec,
  raw: unknown,
): { ok: true; value: unknown } | { ok: false; error: string } {
  const schema = spec.definition.config?.schema;
  if (!schema) return { ok: true, value: raw };
  const result = schema.safeParse(raw);
  return result.success ? { ok: true, value: result.data } : { ok: false, error: result.error.message };
}

/** The one registration-only factory for every app-owned node definition. */
export const nativePluginFactory: PluginFactory = ({ registerNode }) => {
  for (const definition of NATIVE_NODE_DEFINITIONS) registerNode(definition);
};

export function createAppNodeLibrary(
  catalog: NodeCatalog,
  nativeContributions: readonly AnyNativeNodeContribution[] = NATIVE_NODE_CONTRIBUTIONS,
): AppNodeLibrary {
  const nativeByRef = new Map(
    nativeContributions.map((contribution) => [refKey(contribution.definition.ref), contribution]),
  );
  const specs: AppNodeSpec[] = [];

  for (const definition of catalog.listDefinitions()) {
    const entry = catalog.entryExact(definition.ref);
    if (!entry) throw new Error(`catalog lost source for ${refKey(definition.ref)}`);
    if (entry.source.kind === "native") {
      const contribution = nativeByRef.get(refKey(definition.ref));
      if (!contribution) throw new Error(`native node ${refKey(definition.ref)} has no app policy`);
      specs.push(nativeNodeSpecOf(contribution));
    } else if (catalog.resolveCurrent(definition.ref.nodeTypeId) === definition) {
      specs.push(externalNodeSpecOf(definition));
    }
  }

  const frozenSpecs = Object.freeze(specs);
  const specsByType = new Map<GraphNodeType, AppNodeSpec>();
  for (const spec of frozenSpecs) {
    if (specsByType.has(spec.type)) throw new Error(`duplicate app node type "${spec.type}"`);
    specsByType.set(spec.type, spec);
  }
  const descriptors = Object.freeze(frozenSpecs.map(nodeDescriptorOf));
  const descriptorsByType = new Map(descriptors.map((descriptor) => [descriptor.type, descriptor]));
  const palette = Object.freeze(descriptors.filter(({ inPalette }) => inPalette));

  return Object.freeze({
    catalog,
    getSpec: (type: string) => specsByType.get(type),
    getDescriptor: (type: string) => descriptorsByType.get(type),
    listSpecs: () => frozenSpecs,
    listDescriptors: () => descriptors,
    paletteDescriptors: () => palette,
  });
}

/** Test/support helper. Runtime boot owns its catalog through NodeCatalogRegistration. */
export function createNativeAppNodeLibrary(): AppNodeLibrary {
  return createAppNodeLibrary(
    createNodeCatalog([{ source: NATIVE_NODE_SOURCE, definitions: NATIVE_NODE_DEFINITIONS }]),
  );
}

function refKey(ref: ExactNodeTypeRef): string {
  return `${ref.nodeTypeId}@${ref.nodeTypeVersion}`;
}
