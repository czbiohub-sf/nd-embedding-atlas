/** App-local graph registry plus canonical SDK definition registrations. */

import type { ZodType } from "zod";
import type { NodeCapability, NodeDefinition, NodePort, NodeRole } from "@ndea/sdk";

export interface AppGraphNodeSpec {
  readonly id: string;
  readonly title: string;
  readonly inputs: readonly NodePort[];
  readonly outputs: readonly NodePort[];
  readonly config?: ZodType;
}

const GRAPH_NODES = new Map<string, AppGraphNodeSpec>();
const DEFINITIONS = new Map<string, NodeDefinition>();

function serializeMetadata(value: unknown): string | undefined {
  return JSON.stringify(normalizedMetadata(value));
}

function normalizedMetadata(value: unknown): unknown {
  if (value instanceof Set) {
    return [...value]
      .map(normalizedMetadata)
      .toSorted((left, right) =>
        (serializeMetadata(left) ?? "undefined").localeCompare(serializeMetadata(right) ?? "undefined"),
      );
  }
  if (Array.isArray(value)) return value.map(normalizedMetadata);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, child]) => child !== undefined)
        .toSorted(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, normalizedMetadata(child)]),
    );
  }
  return value;
}

function metadataConflict(id: string, field: string, definition: unknown, graph: unknown): Error {
  return new Error(
    `node "${id}" metadata conflict at "${field}": definition=${serializeMetadata(definition)}, graph=${serializeMetadata(graph)}`,
  );
}

function assertMatchingMetadata(definition: NodeDefinition, graph: AppGraphNodeSpec): void {
  const id = definition.ref.nodeTypeId;
  if (graph.id !== id) throw metadataConflict(id, "id", id, graph.id);

  for (const field of ["title", "inputs", "outputs"] as const) {
    const definitionValue = definition[field];
    const graphValue = graph[field];
    if (serializeMetadata(definitionValue) !== serializeMetadata(graphValue))
      throw metadataConflict(id, field, definitionValue, graphValue);
  }

  const graphRole = (graph as AppGraphNodeSpec & { kind?: unknown }).kind;
  if ((graphRole === "view" || graphRole === "transform") && graphRole !== definition.role) {
    throw metadataConflict(id, "role", definition.role, graphRole);
  }
}

function assertMatchingCounterpart(id: string): void {
  const graph = GRAPH_NODES.get(id);
  const definition = DEFINITIONS.get(id);
  if (graph && definition) assertMatchingMetadata(definition, graph);
}

export type RegistrationResult = { ok: true } | { ok: false; error: string };

export function registerDefinition<Config, Capabilities extends readonly NodeCapability[]>(
  definition: NodeDefinition<Config, Capabilities>,
): void {
  const id = definition.ref.nodeTypeId;
  if (DEFINITIONS.has(id)) throw new Error(`duplicate node definition: ${id}`);
  DEFINITIONS.set(id, definition as NodeDefinition);
  try {
    assertMatchingCounterpart(id);
  } catch (error) {
    DEFINITIONS.delete(id);
    throw error;
  }
}

export function tryRegisterExternalDefinition(definition: NodeDefinition): RegistrationResult {
  const id = definition.ref.nodeTypeId;
  if (DEFINITIONS.has(id)) {
    return {
      ok: false,
      error: `node definition "${id}" conflicts with a built-in or already-loaded plugin`,
    };
  }
  try {
    registerDefinition(definition);
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function registerNode(spec: AppGraphNodeSpec): void {
  if (GRAPH_NODES.has(spec.id)) throw new Error(`duplicate graph node: ${spec.id}`);
  GRAPH_NODES.set(spec.id, spec);
  try {
    assertMatchingCounterpart(spec.id);
  } catch (error) {
    GRAPH_NODES.delete(spec.id);
    throw error;
  }
}

export function getNode(id: string): AppGraphNodeSpec | undefined {
  return GRAPH_NODES.get(id);
}

export function listNodes(): AppGraphNodeSpec[] {
  return [...GRAPH_NODES.values()];
}

export function allNodeIds(): string[] {
  return [...GRAPH_NODES.keys()];
}

/** Validates persisted configuration before it enters runtime state. */
export function parseConfig<C>(
  spec: { config?: ZodType<C> },
  raw: unknown,
): { ok: true; value: C } | { ok: false; error: string } {
  if (!spec.config) return { ok: true, value: raw as C };
  const result = spec.config.safeParse(raw);
  return result.success ? { ok: true, value: result.data } : { ok: false, error: result.error.message };
}

export function getDefinition(id: string): NodeDefinition | undefined {
  return DEFINITIONS.get(id);
}

export function listDefinitions(): NodeDefinition[] {
  return [...DEFINITIONS.values()];
}

export function listByRole(role: NodeRole): NodeDefinition[] {
  return listDefinitions().filter((definition) => definition.role === role);
}
