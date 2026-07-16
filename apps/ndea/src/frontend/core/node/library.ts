import type { NdPortKind } from "@/components/nd/nd-port";
import {
  adaptNodeCompute,
  type GraphNodeCookFunction,
  type GraphNodeCookHost,
  type GraphPortValueInputs,
} from "@/core/graph/cook";
import type { GraphNodeRole } from "@/core/graph/records";
import { createNodeCatalog, type NodeCatalog } from "@/core/plugin/catalog";
import {
  NATIVE_NODE_SOURCE,
  type CatalogNodeDefinition,
  type NodeContributionSource,
} from "@/core/plugin/registration";
import type { NativeNodeGeometry, AnyNativeNodeContribution } from "./native-contribution";
import { NATIVE_NODE_CONTRIBUTIONS, NATIVE_NODE_DEFINITIONS } from "./native-nodes";
import type { ExactNodeTypeRef, NodeComputeContext, PluginFactory } from "@ndea/sdk";

export interface AppNodeSpec {
  readonly definition: CatalogNodeDefinition;
  readonly role: GraphNodeRole;
  readonly evaluationRole: "source" | "transform" | "view";
  readonly cook: GraphNodeCookFunction;
  readonly source:
    | NodeContributionSource
    | { readonly kind: "asset"; readonly sourceId: string; readonly sourceKind: "project" | "user" | "embedded" };
  readonly geometry: NativeNodeGeometry;
  readonly body?: "card-and-full" | "full-only";
  readonly stage: "stageable" | "pin-only" | "canvas-only";
  readonly inPalette: boolean;
  readonly accent?: string;
  readonly checkpoint?: boolean;
  readonly checkpointCreation?: boolean;
}

export interface AppNodeDescriptor {
  readonly definitionRef: ExactNodeTypeRef;
  readonly role: GraphNodeRole;
  readonly label: string;
  readonly chipW: number;
  readonly card: NativeNodeGeometry["card"];
  readonly full: NativeNodeGeometry["full"];
  readonly canFull: boolean;
  readonly hasIn: boolean;
  readonly hasOut: boolean;
  readonly outKind: NdPortKind;
  readonly outPortId: string;
  readonly outputPorts: readonly { readonly id: string; readonly kind: NdPortKind }[];
  readonly inKinds: readonly NdPortKind[];
  readonly inputPorts: readonly { readonly id: string; readonly kind: NdPortKind }[];
  readonly stage: "stageable" | "pin-only" | "canvas-only";
  readonly inPalette: boolean;
}

/** Immutable session projection of the one frozen node catalog. */
export interface AppNodeLibrary {
  readonly catalog: NodeCatalog;
  getSpecExact(ref: ExactNodeTypeRef): AppNodeSpec | undefined;
  getCurrentSpec(nodeTypeId: string): AppNodeSpec | undefined;
  getDescriptorExact(ref: ExactNodeTypeRef): AppNodeDescriptor | undefined;
  getCurrentDescriptor(nodeTypeId: string): AppNodeDescriptor | undefined;
  listSpecs(): readonly AppNodeSpec[];
  listDescriptors(): readonly AppNodeDescriptor[];
  paletteDescriptors(): readonly AppNodeDescriptor[];
}

export function nativeNodeSpecOf(
  contribution: AnyNativeNodeContribution,
  source: NodeContributionSource = NATIVE_NODE_SOURCE,
): AppNodeSpec {
  return Object.freeze({
    definition: contribution.definition,
    role: contribution.graph.role,
    evaluationRole: contribution.graph.evaluationRole,
    cook: contribution.graph.cook,
    source,
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

export function externalNodeSpecOf(definition: CatalogNodeDefinition, source: NodeContributionSource): AppNodeSpec {
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
    role,
    evaluationRole: role,
    cook: (inputs: GraphPortValueInputs, _host: GraphNodeCookHost, context?: NodeComputeContext) => {
      if (!context) throw new Error(`node "${definition.ref.nodeTypeId}" requires a compute context`);
      return compute(inputs, context);
    },
    source,
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
    definitionRef: spec.definition.ref,
    role: spec.role,
    label: spec.definition.title,
    chipW: spec.geometry.chipW,
    card: spec.geometry.card,
    full: spec.geometry.full,
    canFull: spec.geometry.canFull,
    hasIn: spec.definition.inputs.length > 0,
    hasOut: spec.definition.outputs.length > 0,
    outKind: outputPortKindOf(spec),
    outPortId: spec.definition.outputs[0]?.id ?? "out",
    outputPorts: Object.freeze(
      spec.definition.outputs.map((port) => Object.freeze({ id: port.id, kind: port.kind as NdPortKind })),
    ),
    inKinds: Object.freeze(inputPortKindsOf(spec)),
    inputPorts: Object.freeze(
      spec.definition.inputs.map((port) => Object.freeze({ id: port.id, kind: port.kind as NdPortKind })),
    ),
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
      specs.push(nativeNodeSpecOf(contribution, entry.source));
    } else {
      specs.push(externalNodeSpecOf(definition, entry.source));
    }
  }

  const frozenSpecs = Object.freeze(specs);
  const specsByRef = new Map<string, AppNodeSpec>();
  for (const spec of frozenSpecs) {
    const key = refKey(spec.definition.ref);
    if (specsByRef.has(key)) throw new Error(`duplicate app node definition "${key}"`);
    specsByRef.set(key, spec);
  }
  const descriptors = Object.freeze(frozenSpecs.map(nodeDescriptorOf));
  const descriptorsByRef = new Map(descriptors.map((descriptor) => [refKey(descriptor.definitionRef), descriptor]));
  const palette = Object.freeze(
    descriptors.filter(({ definitionRef, inPalette }) => {
      const current = catalog.resolveCurrent(definitionRef.nodeTypeId);
      return inPalette && current !== undefined && refKey(current.ref) === refKey(definitionRef);
    }),
  );

  return Object.freeze({
    catalog,
    getSpecExact: (ref: ExactNodeTypeRef) => specsByRef.get(refKey(ref)),
    getCurrentSpec: (nodeTypeId: string) => {
      const definition = catalog.resolveCurrent(nodeTypeId);
      return definition ? specsByRef.get(refKey(definition.ref)) : undefined;
    },
    getDescriptorExact: (ref: ExactNodeTypeRef) => descriptorsByRef.get(refKey(ref)),
    getCurrentDescriptor: (nodeTypeId: string) => {
      const definition = catalog.resolveCurrent(nodeTypeId);
      return definition ? descriptorsByRef.get(refKey(definition.ref)) : undefined;
    },
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
