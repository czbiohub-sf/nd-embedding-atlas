import {
  exactNodeTypeRef,
  isSemanticVersion,
  nodeAssetVersion,
  nodeConfigVersion,
  type ExactNodeTypeRef,
  type JsonValue,
  type NodeAssetVersion,
  type NodeConfigSnapshot,
  type PortKind,
} from "@ndea/sdk";
import { z } from "zod";

declare const NODE_ASSET_ID: unique symbol;
export type NodeAssetId = string & { readonly [NODE_ASSET_ID]: true };

export function nodeAssetId(value: string): NodeAssetId {
  return value as NodeAssetId;
}

export { nodeAssetVersion };
export type { NodeAssetVersion };

export interface ExactNodeAssetRef {
  readonly assetId: NodeAssetId;
  readonly assetVersion: NodeAssetVersion;
}

export interface NodeAssetNodeDependency {
  readonly kind: "node";
  readonly definitionRef: ExactNodeTypeRef;
}

export interface NodeAssetAssetDependency {
  readonly kind: "asset";
  readonly assetRef: ExactNodeAssetRef;
}

export type NodeAssetDependency = NodeAssetNodeDependency | NodeAssetAssetDependency;

export interface NodeAssetInnerNode {
  readonly id: string;
  readonly definitionRef: ExactNodeTypeRef;
  readonly config?: NodeConfigSnapshot;
}

export interface NodeAssetInnerEdge {
  readonly id: string;
  readonly from: string;
  readonly fromPort: string;
  readonly to: string;
  readonly toPort: string;
  readonly kind: PortKind;
}

export interface NodeAssetInputPort {
  readonly id: string;
  readonly label: string;
  readonly kind: PortKind;
  readonly target: { readonly nodeId: string; readonly portId: string };
}

export interface NodeAssetOutputPort {
  readonly id: string;
  readonly label: string;
  readonly kind: PortKind;
  readonly source: { readonly nodeId: string; readonly portId: string };
}

export interface NodeAssetParameter {
  readonly id: string;
  readonly label: string;
  readonly defaultValue: JsonValue;
  readonly target: { readonly nodeId: string; readonly configPath: readonly string[] };
  readonly documentation?: string;
}

export interface NodeAssetDefinition {
  readonly schemaVersion: 1;
  readonly assetId: NodeAssetId;
  readonly assetVersion: NodeAssetVersion;
  readonly nodeTypeRef: ExactNodeTypeRef;
  readonly title: string;
  readonly dependencies: readonly NodeAssetDependency[];
  readonly nodes: readonly NodeAssetInnerNode[];
  readonly edges: readonly NodeAssetInnerEdge[];
  readonly inputs: readonly NodeAssetInputPort[];
  readonly outputs: readonly NodeAssetOutputPort[];
  readonly parameters: readonly NodeAssetParameter[];
  readonly documentation: {
    readonly summary: string;
    readonly details?: string;
  };
  readonly presentation: {
    readonly accent?: string;
    readonly preferredBodySize?: { readonly width: number; readonly height: number };
  };
  readonly visibility: "public" | "hidden" | "internal";
}

export interface LinkedNodeAssetRecord {
  readonly kind: "linked";
  readonly sourceId: string;
  readonly assetRef: ExactNodeAssetRef;
  readonly nodeTypeRef: ExactNodeTypeRef;
  readonly fallback?: NodeAssetDefinition;
}

export interface EmbeddedNodeAssetRecord {
  readonly kind: "embedded";
  readonly definition: NodeAssetDefinition;
}

export type WorkspaceNodeAssetRecord = LinkedNodeAssetRecord | EmbeddedNodeAssetRecord;

const assetIdPattern = /^[a-z0-9]+(?:[.-][a-z0-9]+)*(?:\/[a-z0-9]+(?:[.-][a-z0-9]+)*)+$/;
const nodeTypeIdPattern = /^[a-z0-9]+(?:[.-][a-z0-9]+)*(?:\/[a-z0-9]+(?:[.-][a-z0-9]+)*)*$/;
const localIdPattern = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const portIdPattern = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

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

const exactNodeTypeRefSchema = z
  .object({
    nodeTypeId: z.string().regex(nodeTypeIdPattern),
    nodeTypeVersion: z.string().refine(isSemanticVersion, "node type version must be semantic"),
  })
  .strict()
  .transform((ref) => exactNodeTypeRef(ref.nodeTypeId, ref.nodeTypeVersion));

const exactNodeAssetRefSchema = z
  .object({
    assetId: z.string().regex(assetIdPattern),
    assetVersion: z.string().refine(isSemanticVersion, "node asset version must be semantic"),
  })
  .strict()
  .transform((ref) => ({ assetId: nodeAssetId(ref.assetId), assetVersion: nodeAssetVersion(ref.assetVersion) }));

const configSnapshotSchema = z
  .object({
    version: z.number().int().nonnegative().refine(Number.isSafeInteger, "config version must be safe"),
    value: jsonValueSchema,
  })
  .strict()
  .transform((config) => ({ version: nodeConfigVersion(config.version), value: config.value }));

const dependencySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("node"), definitionRef: exactNodeTypeRefSchema }).strict(),
  z.object({ kind: z.literal("asset"), assetRef: exactNodeAssetRefSchema }).strict(),
]);

const nodeSchema = z
  .object({
    id: z.string().regex(localIdPattern),
    definitionRef: exactNodeTypeRefSchema,
    config: configSnapshotSchema.optional(),
  })
  .strict();

const edgeSchema = z
  .object({
    id: z.string().regex(localIdPattern),
    from: z.string().regex(localIdPattern),
    fromPort: z.string().regex(portIdPattern),
    to: z.string().regex(localIdPattern),
    toPort: z.string().regex(portIdPattern),
    kind: z.enum(["pred", "sel", "focus"]),
  })
  .strict();

const inputSchema = z
  .object({
    id: z.string().regex(portIdPattern),
    label: z.string().min(1),
    kind: z.enum(["pred", "sel", "focus"]),
    target: z.object({ nodeId: z.string().regex(localIdPattern), portId: z.string().regex(portIdPattern) }).strict(),
  })
  .strict();

const outputSchema = z
  .object({
    id: z.string().regex(portIdPattern),
    label: z.string().min(1),
    kind: z.enum(["pred", "sel", "focus"]),
    source: z.object({ nodeId: z.string().regex(localIdPattern), portId: z.string().regex(portIdPattern) }).strict(),
  })
  .strict();

const parameterSchema = z
  .object({
    id: z.string().regex(portIdPattern),
    label: z.string().min(1),
    defaultValue: jsonValueSchema,
    target: z
      .object({
        nodeId: z.string().regex(localIdPattern),
        configPath: z
          .array(z.string().min(1))
          .min(1)
          .refine(
            (path) => path.every((part) => part !== "__proto__" && part !== "prototype" && part !== "constructor"),
            "unsafe config path",
          ),
      })
      .strict(),
    documentation: z.string().optional(),
  })
  .strict();

const nodeAssetDefinitionSchema = z
  .object({
    schemaVersion: z.literal(1),
    assetId: z.string().regex(assetIdPattern),
    assetVersion: z.string().refine(isSemanticVersion, "node asset version must be semantic"),
    nodeTypeRef: exactNodeTypeRefSchema,
    title: z.string().min(1),
    dependencies: z.array(dependencySchema),
    nodes: z.array(nodeSchema),
    edges: z.array(edgeSchema),
    inputs: z.array(inputSchema),
    outputs: z.array(outputSchema),
    parameters: z.array(parameterSchema),
    documentation: z.object({ summary: z.string().min(1), details: z.string().optional() }).strict(),
    presentation: z
      .object({
        accent: z.string().optional(),
        preferredBodySize: z
          .object({ width: z.number().positive(), height: z.number().positive() })
          .strict()
          .optional(),
      })
      .strict(),
    visibility: z.enum(["public", "hidden", "internal"]),
  })
  .strict()
  .transform((definition) => ({
    ...definition,
    assetId: nodeAssetId(definition.assetId),
    assetVersion: nodeAssetVersion(definition.assetVersion),
  }))
  .superRefine((definition, context) => validateDefinitionShape(definition as NodeAssetDefinition, context));

const linkedRecordSchema = z
  .object({
    kind: z.literal("linked"),
    sourceId: z.string().min(1),
    assetRef: exactNodeAssetRefSchema,
    nodeTypeRef: exactNodeTypeRefSchema,
    fallback: nodeAssetDefinitionSchema.optional(),
  })
  .strict();
const embeddedRecordSchema = z.object({ kind: z.literal("embedded"), definition: nodeAssetDefinitionSchema }).strict();
const workspaceRecordSchema = z.discriminatedUnion("kind", [linkedRecordSchema, embeddedRecordSchema]);

export function parseNodeAssetDefinition(value: unknown): NodeAssetDefinition {
  return deepFreeze(nodeAssetDefinitionSchema.parse(value) as NodeAssetDefinition);
}

export function safeParseNodeAssetDefinition(
  value: unknown,
):
  | { readonly ok: true; readonly value: NodeAssetDefinition }
  | { readonly ok: false; readonly errors: readonly string[] } {
  const parsed = nodeAssetDefinitionSchema.safeParse(value);
  return parsed.success
    ? { ok: true, value: deepFreeze(parsed.data as NodeAssetDefinition) }
    : {
        ok: false,
        errors: Object.freeze(
          parsed.error.issues.map((diagnostic) => `${diagnostic.path.join(".")}: ${diagnostic.message}`),
        ),
      };
}

export function parseWorkspaceNodeAssetRecord(value: unknown): WorkspaceNodeAssetRecord {
  const record = workspaceRecordSchema.parse(value) as WorkspaceNodeAssetRecord;
  validateWorkspaceRecord(record);
  return deepFreeze(record);
}

export function parseWorkspaceNodeAssetRecords(value: unknown): readonly WorkspaceNodeAssetRecord[] {
  const records = z.array(workspaceRecordSchema).parse(value) as WorkspaceNodeAssetRecord[];
  const seen = new Set<string>();
  for (const record of records) {
    validateWorkspaceRecord(record);
    const ref = record.kind === "linked" ? record.nodeTypeRef : record.definition.nodeTypeRef;
    const key = exactNodeRefKey(ref);
    if (seen.has(key)) throw new Error(`duplicate Workspace node asset record "${key}"`);
    seen.add(key);
  }
  return deepFreeze(records);
}

export function exactNodeAssetRefKey(ref: ExactNodeAssetRef): string {
  return `${ref.assetId}@${ref.assetVersion}`;
}

export function exactNodeRefKey(ref: ExactNodeTypeRef): string {
  return `${ref.nodeTypeId}@${ref.nodeTypeVersion}`;
}

export function assetNodeTypeId(assetId: string): string {
  return `asset/${assetId}`;
}

function validateDefinitionShape(definition: NodeAssetDefinition, context: z.RefinementCtx): void {
  if (definition.nodeTypeRef.nodeTypeId !== assetNodeTypeId(definition.assetId)) {
    issue(context, ["nodeTypeRef", "nodeTypeId"], `node type id must be "${assetNodeTypeId(definition.assetId)}"`);
  }
  if (String(definition.nodeTypeRef.nodeTypeVersion) !== String(definition.assetVersion)) {
    issue(context, ["nodeTypeRef", "nodeTypeVersion"], "node type version must equal the published node asset version");
  }

  unique(definition.nodes, "node id", context, ["nodes"], (value) => value.id);
  unique(definition.edges, "edge id", context, ["edges"], (value) => value.id);
  unique(definition.inputs, "input port", context, ["inputs"], (value) => value.id);
  unique(definition.outputs, "output port", context, ["outputs"], (value) => value.id);
  unique(definition.parameters, "parameter", context, ["parameters"], (value) => value.id);
  unique(definition.dependencies, "dependency", context, ["dependencies"], dependencyKey);

  const nodeIds = new Set(definition.nodes.map((node) => node.id));
  for (const [index, edge] of definition.edges.entries()) {
    if (!nodeIds.has(edge.from)) issue(context, ["edges", index, "from"], `unknown source node "${edge.from}"`);
    if (!nodeIds.has(edge.to)) issue(context, ["edges", index, "to"], `unknown target node "${edge.to}"`);
    if (edge.from === edge.to) issue(context, ["edges", index], "self edges are not allowed");
  }
  for (const [index, input] of definition.inputs.entries()) {
    if (!nodeIds.has(input.target.nodeId))
      issue(context, ["inputs", index, "target", "nodeId"], `unknown target node "${input.target.nodeId}"`);
  }
  for (const [index, output] of definition.outputs.entries()) {
    if (!nodeIds.has(output.source.nodeId))
      issue(context, ["outputs", index, "source", "nodeId"], `unknown source node "${output.source.nodeId}"`);
  }
  for (const [index, parameter] of definition.parameters.entries()) {
    if (!nodeIds.has(parameter.target.nodeId))
      issue(context, ["parameters", index, "target", "nodeId"], `unknown target node "${parameter.target.nodeId}"`);
  }

  const dependencyKeys = new Set(definition.dependencies.map(dependencyKey));
  for (const [index, node] of definition.nodes.entries()) {
    const key = node.definitionRef.nodeTypeId.startsWith("asset/")
      ? `asset:${node.definitionRef.nodeTypeId.slice("asset/".length)}@${node.definitionRef.nodeTypeVersion}`
      : `node:${exactNodeRefKey(node.definitionRef)}`;
    if (!dependencyKeys.has(key))
      issue(context, ["nodes", index, "definitionRef"], `dependency mismatch for "${key.slice(key.indexOf(":") + 1)}"`);
  }
  for (const dependency of definition.dependencies) {
    const used = definition.nodes.some((node) =>
      dependency.kind === "node"
        ? exactNodeRefKey(node.definitionRef) === exactNodeRefKey(dependency.definitionRef)
        : node.definitionRef.nodeTypeId === assetNodeTypeId(dependency.assetRef.assetId) &&
          String(node.definitionRef.nodeTypeVersion) === String(dependency.assetRef.assetVersion),
    );
    if (!used)
      issue(
        context,
        ["dependencies"],
        `unused exact dependency "${dependency.kind === "node" ? exactNodeRefKey(dependency.definitionRef) : exactNodeAssetRefKey(dependency.assetRef)}"`,
      );
  }

  const adjacency = new Map(definition.nodes.map((node) => [node.id, [] as string[]]));
  for (const edge of definition.edges) adjacency.get(edge.from)?.push(edge.to);
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string, trace: string[]): void => {
    if (visiting.has(id)) {
      issue(context, ["edges"], `inner graph cycle: ${[...trace, id].join(" -> ")}`);
      return;
    }
    if (visited.has(id)) return;
    visiting.add(id);
    for (const next of adjacency.get(id) ?? []) visit(next, [...trace, id]);
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of adjacency.keys()) visit(id, []);
}

function dependencyKey(dependency: NodeAssetDependency): string {
  return dependency.kind === "node"
    ? `node:${exactNodeRefKey(dependency.definitionRef)}`
    : `asset:${exactNodeAssetRefKey(dependency.assetRef)}`;
}

function validateWorkspaceRecord(record: WorkspaceNodeAssetRecord): void {
  if (record.kind === "embedded") return;
  if (
    record.nodeTypeRef.nodeTypeId !== assetNodeTypeId(record.assetRef.assetId) ||
    String(record.nodeTypeRef.nodeTypeVersion) !== String(record.assetRef.assetVersion)
  ) {
    throw new Error(`linked node asset record identity mismatch for "${exactNodeAssetRefKey(record.assetRef)}"`);
  }
  if (record.fallback) {
    if (
      record.fallback.assetId !== record.assetRef.assetId ||
      String(record.fallback.assetVersion) !== String(record.assetRef.assetVersion) ||
      exactNodeRefKey(record.fallback.nodeTypeRef) !== exactNodeRefKey(record.nodeTypeRef)
    ) {
      throw new Error(`linked fallback must exactly match "${exactNodeAssetRefKey(record.assetRef)}"`);
    }
  }
}

function unique<T>(
  values: readonly T[],
  label: string,
  context: z.RefinementCtx,
  path: PropertyKey[],
  keyOf: (value: T) => string,
): void {
  const seen = new Set<string>();
  for (const [index, value] of values.entries()) {
    const key = keyOf(value);
    if (seen.has(key)) issue(context, [...path, index], `duplicate ${label} "${key}"`);
    seen.add(key);
  }
}

function issue(context: z.RefinementCtx, path: PropertyKey[], message: string): void {
  context.addIssue({ code: "custom", path, message });
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
  return value;
}
