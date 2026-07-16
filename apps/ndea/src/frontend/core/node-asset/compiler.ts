import {
  defineNode,
  exactNodeTypeRef,
  nodeConfigVersion,
  type JsonValue,
  type NodeConfigSnapshot,
  type PortKind,
} from "@ndea/sdk";
import { z } from "zod";

import type { GraphPortValueInputs } from "@/core/graph/cook";
import type { GraphDocumentEdge, GraphDocumentNode } from "@/core/graph/records";
import type { GraphRuntimeNodeResolver, GraphRuntimeNodeSpec } from "@/core/graph/runtime-session";
import type { AppNodeSpec } from "@/core/node/library";
import type { NodeAssetSourceKind } from "./library";
import { exactNodeRefKey, parseNodeAssetDefinition, type NodeAssetDefinition, type NodeAssetParameter } from "./schema";

export interface CompiledNodeAssetSource {
  readonly sourceId: string;
  readonly kind: NodeAssetSourceKind;
}

export interface NodeAssetExpansionDescriptor {
  readonly definition: NodeAssetDefinition;
  readonly innerSpecs: ReadonlyMap<string, GraphRuntimeNodeSpec>;
}

export interface CompiledNodeAsset {
  readonly spec: AppNodeSpec;
  readonly expansion: NodeAssetExpansionDescriptor;
}

export interface ExpandedNodeAssetNode extends GraphDocumentNode {
  readonly runtimeSpec: GraphRuntimeNodeSpec;
  readonly boundary?: { readonly direction: "input" | "output"; readonly portId: string };
}

export interface InstantiatedNodeAssetExpansion {
  readonly outerId: string;
  readonly nodes: readonly ExpandedNodeAssetNode[];
  readonly edges: readonly GraphDocumentEdge[];
  readonly inputNodeIds: Readonly<Record<string, string>>;
  readonly outputNodeIds: Readonly<Record<string, string>>;
}

export interface NodeAssetExpansionResolver extends GraphRuntimeNodeResolver {
  getAssetExpansionExact?(ref: NodeAssetDefinition["nodeTypeRef"]): NodeAssetExpansionDescriptor | undefined;
}

export interface NodeAssetCompileResolver extends GraphRuntimeNodeResolver {
  getCurrentSpec?(nodeTypeId: string): GraphRuntimeNodeSpec | undefined;
}

export function compileNodeAsset(
  value: unknown,
  resolver: NodeAssetCompileResolver,
  source: CompiledNodeAssetSource,
): CompiledNodeAsset {
  const definition = parseNodeAssetDefinition(value);
  if (resolver.getSpecExact(definition.nodeTypeRef) || resolver.getCurrentSpec?.(definition.nodeTypeRef.nodeTypeId)) {
    throw new Error(`node asset type shadows an existing node definition "${definition.nodeTypeRef.nodeTypeId}"`);
  }
  if (definition.outputs.length === 0) throw new Error("node asset must promote at least one output");

  const innerSpecs = new Map<string, GraphRuntimeNodeSpec>();
  for (const node of definition.nodes) {
    const spec = resolver.getSpecExact(node.definitionRef);
    if (!spec) throw new Error(`node asset dependency "${exactNodeRefKey(node.definitionRef)}" is unavailable`);
    if (node.config !== undefined) validateConfig(node.id, node.config, spec);
    innerSpecs.set(node.id, spec);
  }

  const wires = new Set<string>();
  for (const edge of definition.edges) {
    const wireKey = JSON.stringify([edge.from, edge.fromPort, edge.to, edge.toPort]);
    if (wires.has(wireKey)) throw new Error(`node asset duplicates inner wire "${edge.id}"`);
    wires.add(wireKey);
    const sourceSpec = innerSpecs.get(edge.from)!;
    const targetSpec = innerSpecs.get(edge.to)!;
    const sourcePort = sourceSpec.definition.outputs.find((port) => port.id === edge.fromPort);
    if (!sourcePort) throw new Error(`edge "${edge.id}" references missing source port "${edge.fromPort}"`);
    const targetPort = targetSpec.definition.inputs.find((port) => port.id === edge.toPort);
    if (!targetPort) throw new Error(`edge "${edge.id}" references missing target port "${edge.toPort}"`);
    if (sourcePort.kind !== edge.kind || targetPort.kind !== edge.kind) {
      throw new Error(`edge "${edge.id}" kind "${edge.kind}" is incompatible with its exact ports`);
    }
  }

  for (const input of definition.inputs) {
    const spec = innerSpecs.get(input.target.nodeId)!;
    const port = spec.definition.inputs.find((candidate) => candidate.id === input.target.portId);
    if (!port) throw new Error(`promoted input "${input.id}" references missing target port "${input.target.portId}"`);
    if (port.kind !== input.kind)
      throw new Error(`promoted input "${input.id}" kind is incompatible with its target port`);
  }
  for (const output of definition.outputs) {
    const spec = innerSpecs.get(output.source.nodeId)!;
    const port = spec.definition.outputs.find((candidate) => candidate.id === output.source.portId);
    if (!port)
      throw new Error(`promoted output "${output.id}" references missing source port "${output.source.portId}"`);
    if (port.kind !== output.kind)
      throw new Error(`promoted output "${output.id}" kind is incompatible with its source port`);
  }
  const parameterShape = nodeAssetParameterShape(definition.parameters);
  const defaultParameters = nodeAssetParameterDefaults(definition.parameters);
  const parameterTargets = new Set<string>();
  for (const parameter of definition.parameters) {
    const targetKey = JSON.stringify([parameter.target.nodeId, ...parameter.target.configPath]);
    if (parameterTargets.has(targetKey)) {
      throw new Error(`promoted parameter "${parameter.id}" duplicates an existing config target`);
    }
    parameterTargets.add(targetKey);
    validateParameter(parameter, definition, innerSpecs);
  }
  for (const node of definition.nodes) {
    if (definition.parameters.some((parameter) => parameter.target.nodeId === node.id)) {
      patchedInnerConfig(node.id, node.config, innerSpecs.get(node.id)!, definition.parameters, defaultParameters);
    }
  }

  const preferred = definition.presentation.preferredBodySize ?? { width: 240, height: 120 };
  const graphDefinition = defineNode({
    ref: definition.nodeTypeRef,
    title: definition.title,
    role: "transform" as const,
    inputs: definition.inputs.map(({ id, kind, label }) => ({ id, kind, label })),
    outputs: definition.outputs.map(({ id, kind, label }) => ({ id, kind, label })),
    capabilities: [],
    config:
      definition.parameters.length > 0
        ? {
            version: nodeConfigVersion(1),
            defaultValue: defaultParameters,
            schema: z.object(parameterShape).strict(),
          }
        : undefined,
    documentation: {
      summary: definition.documentation.summary,
      use: definition.documentation.details ?? definition.documentation.summary,
      ...(definition.documentation.details ? { note: definition.documentation.details } : {}),
    },
    presentation: { preferredBodySize: preferred },
  });
  const spec: AppNodeSpec = Object.freeze({
    definition: graphDefinition,
    role: "transform",
    evaluationRole: "transform",
    cook: (inputs: GraphPortValueInputs) => firstInputOrDefault(inputs, definition.outputs[0]?.kind ?? "pred"),
    source: Object.freeze({ kind: "asset", sourceId: source.sourceId, sourceKind: source.kind }),
    geometry: Object.freeze({
      chipW: 160,
      card: Object.freeze({ w: preferred.width, h: preferred.height }),
      full: Object.freeze({ w: preferred.width, h: preferred.height }),
      canFull: false,
    }),
    stage: "canvas-only",
    inPalette: definition.visibility === "public",
    ...(definition.presentation.accent ? { accent: definition.presentation.accent } : {}),
  });
  return Object.freeze({
    spec,
    expansion: Object.freeze({ definition, innerSpecs }),
  });
}

export function instantiateNodeAssetExpansion(
  descriptor: NodeAssetExpansionDescriptor,
  outerId: string,
  parameterValues: unknown = {},
): InstantiatedNodeAssetExpansion {
  const definition = descriptor.definition;
  const parameterSchema = z.object(nodeAssetParameterShape(definition.parameters)).strict();
  const defaults = nodeAssetParameterDefaults(definition.parameters);
  const supplied = parameterSchema.partial().parse(parameterValues);
  const parameters = parameterSchema.parse({ ...defaults, ...supplied });
  const nodes: ExpandedNodeAssetNode[] = definition.nodes.map((node) => {
    const spec = descriptor.innerSpecs.get(node.id)!;
    const config = patchedInnerConfig(node.id, node.config, spec, definition.parameters, parameters);
    return {
      id: assetInnerNodeId(outerId, node.id),
      definitionRef: node.definitionRef,
      label: node.id,
      ...(config ? { config } : {}),
      runtimeSpec: spec,
    };
  });
  const edges: GraphDocumentEdge[] = definition.edges.map((edge) => ({
    id: assetInnerEdgeId(outerId, edge.id),
    from: assetInnerNodeId(outerId, edge.from),
    fromPort: edge.fromPort,
    to: assetInnerNodeId(outerId, edge.to),
    toPort: edge.toPort,
    kind: edge.kind,
  }));
  const inputNodeIds: Record<string, string> = {};
  for (const input of definition.inputs) {
    const id = assetInputBoundaryNodeId(outerId, input.id);
    inputNodeIds[input.id] = id;
    nodes.push({
      id,
      definitionRef: boundaryRef("input", input.kind),
      label: input.label,
      runtimeSpec: boundarySpec("input", input.kind),
      boundary: { direction: "input", portId: input.id },
    });
    edges.push({
      id: `${id}::edge`,
      from: id,
      fromPort: "out",
      to: assetInnerNodeId(outerId, input.target.nodeId),
      toPort: input.target.portId,
      kind: input.kind,
    });
  }
  const outputNodeIds: Record<string, string> = {};
  for (const output of definition.outputs) {
    const id = assetOutputBoundaryNodeId(outerId, output.id);
    outputNodeIds[output.id] = id;
    nodes.push({
      id,
      definitionRef: boundaryRef("output", output.kind),
      label: output.label,
      runtimeSpec: boundarySpec("output", output.kind),
      boundary: { direction: "output", portId: output.id },
    });
    edges.push({
      id: `${id}::edge`,
      from: assetInnerNodeId(outerId, output.source.nodeId),
      fromPort: output.source.portId,
      to: id,
      toPort: "in",
      kind: output.kind,
    });
  }
  return Object.freeze({
    outerId,
    nodes: Object.freeze(nodes),
    edges: Object.freeze(edges),
    inputNodeIds: Object.freeze(inputNodeIds),
    outputNodeIds: Object.freeze(outputNodeIds),
  });
}

export function assetInnerNodeId(outerId: string, localId: string): string {
  return `${outerId}::asset::${localId}`;
}

export function assetInputBoundaryNodeId(outerId: string, portId: string): string {
  return `${outerId}::asset::in::${portId}`;
}

export function assetOutputBoundaryNodeId(outerId: string, portId: string): string {
  return `${outerId}::asset::out::${portId}`;
}

export function assetInnerEdgeId(outerId: string, localId: string): string {
  return `${outerId}::asset::edge::${localId}`;
}

function validateConfig(id: string, config: NodeConfigSnapshot, spec: GraphRuntimeNodeSpec): void {
  const contract = spec.definition.config;
  if (!contract) throw new Error(`inner node "${id}" does not accept config`);
  if (config.version !== contract.version) {
    throw new Error(
      `inner node "${id}" config version ${config.version} does not match exact version ${contract.version}`,
    );
  }
  try {
    contract.schema.parse(config.value);
  } catch (error) {
    throw new Error(`inner node "${id}" has invalid config`, { cause: error });
  }
}

function validateParameter(
  parameter: NodeAssetParameter,
  definition: NodeAssetDefinition,
  specs: ReadonlyMap<string, GraphRuntimeNodeSpec>,
): void {
  const node = definition.nodes.find((candidate) => candidate.id === parameter.target.nodeId)!;
  const spec = specs.get(node.id)!;
  const contract = spec.definition.config;
  if (!contract) throw new Error(`promoted parameter "${parameter.id}" targets a node without config`);
  const base = node.config?.value ?? contract.defaultValue;
  const patched = patchJsonPath(base as JsonValue, parameter.target.configPath, parameter.defaultValue);
  try {
    contract.schema.parse(patched);
  } catch (error) {
    throw new Error(`promoted parameter "${parameter.id}" default is incompatible with target config`, {
      cause: error,
    });
  }
}

function patchedInnerConfig(
  nodeId: string,
  stored: NodeConfigSnapshot | undefined,
  spec: GraphRuntimeNodeSpec,
  bindings: readonly NodeAssetParameter[],
  values: Readonly<Record<string, JsonValue>>,
): NodeConfigSnapshot | undefined {
  const targeted = bindings.filter((binding) => binding.target.nodeId === nodeId);
  const contract = spec.definition.config;
  if (!contract) return undefined;
  let value = structuredClone((stored?.value ?? contract.defaultValue) as JsonValue);
  for (const binding of targeted) value = patchJsonPath(value, binding.target.configPath, values[binding.id]);
  try {
    value = contract.schema.parse(value) as JsonValue;
  } catch (error) {
    throw new Error(`promoted parameters produce invalid config for inner node "${nodeId}"`, { cause: error });
  }
  return { version: nodeConfigVersion(contract.version), value };
}

function patchJsonPath(value: JsonValue, path: readonly string[], replacement: JsonValue): JsonValue {
  if (path.length === 0) return structuredClone(replacement);
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`cannot patch config path "${path.join(".")}" through a non-object value`);
  }
  const [head, ...tail] = path;
  if (!(head in value)) throw new Error(`config path "${path.join(".")}" does not exist`);
  return { ...value, [head]: patchJsonPath(value[head], tail, replacement) };
}

function nodeAssetParameterShape(parameters: readonly NodeAssetParameter[]): Record<string, z.ZodType<JsonValue>> {
  return Object.fromEntries(parameters.map((parameter) => [parameter.id, jsonValueSchema]));
}

function nodeAssetParameterDefaults(parameters: readonly NodeAssetParameter[]): Record<string, JsonValue> {
  return Object.fromEntries(parameters.map((parameter) => [parameter.id, structuredClone(parameter.defaultValue)]));
}

function firstInputOrDefault(inputs: GraphPortValueInputs, kind: PortKind) {
  const value = inputs.values().next().value?.[0];
  if (value) return value;
  if (kind === "sel") return { kind: "sel" as const, sql: null, rowIds: null };
  if (kind === "focus") return { kind: "focus" as const, rowIndex: null };
  return { kind: "pred" as const, sql: null };
}

function boundaryRef(direction: "input" | "output", kind: PortKind) {
  return exactNodeTypeRef(`ndea/internal/asset-${direction}-${kind}`, "1.0.0");
}

function boundarySpec(direction: "input" | "output", kind: PortKind): GraphRuntimeNodeSpec {
  const key = `${direction}:${kind}`;
  const existing = boundarySpecs.get(key);
  if (existing) return existing;
  const spec = Object.freeze({
    definition: Object.freeze({
      ref: boundaryRef(direction, kind),
      inputs: Object.freeze([{ id: "in", kind }]),
      outputs: Object.freeze([{ id: "out", kind }]),
    }),
    evaluationRole: "transform" as const,
    cook: (inputs: GraphPortValueInputs) => firstInputOrDefault(inputs, kind),
  });
  boundarySpecs.set(key, spec);
  return spec;
}

const boundarySpecs = new Map<string, GraphRuntimeNodeSpec>();

const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number(),
    z.string(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);
