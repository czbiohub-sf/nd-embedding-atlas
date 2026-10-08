/**
 * Named workspace edits for agents. Each op runs against a draft of the
 * document through the same pure helpers the browser uses (stage spec,
 * coordination, config contracts); the caller diffs the draft against the
 * base into one RFC 6902 patch, so every edit still meets the one validated
 * write path. An op that cannot apply throws `WorkspaceEditError` naming it.
 */

import { FilterClauseSchema, type FilterClause } from "@ndea/protocol";
import { z } from "zod";

import {
  createCoordination,
  withoutNodeCoordination,
  type CoordinationScopeCellPort,
} from "../frontend/core/coordination/coordination.ts";
import {
  COORDINATION_TYPE_IDS,
  COORDINATION_TYPES,
  type CoordinationTypeId,
} from "../frontend/core/coordination/types.ts";
import { patchNodeConfig } from "../frontend/core/graph/cook.ts";
import type { GraphDocumentEdge, GraphDocumentNode } from "../frontend/core/graph/records.ts";
import { addView, removeNodeView, stageViews } from "../frontend/core/workspace/stage/stage-spec.ts";
import type { WorkspaceDocument, WorkspaceNodePosition } from "../frontend/core/workspace/types.ts";
import type { ServerNodeDefinition, ServerNodeResolver } from "./graph.ts";

const NodeIdSchema = z
  .string()
  .regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/, "node ids start with a letter and use letters, digits, _ and -");
const ScopeSchema = z.string().regex(/^[A-Za-z0-9_-]+$/, "scope names use letters, digits, _ and -");
const CoordinationTypeSchema = z.enum(COORDINATION_TYPE_IDS);

/** Node types an agent cannot place: the one data source and the subnet seam machinery. */
export const NOT_ADDABLE: ReadonlySet<string> = new Set(["obs", "proxy", "subnet"]);

export const GraphEditSchema = z.discriminatedUnion("op", [
  z
    .object({
      op: z.literal("add_node"),
      type: z.string().describe("node type id from list_node_types, e.g. `filter`, `table`, `histogram`"),
      id: NodeIdSchema.optional().describe("id for the new node; later ops in the same call may reference it"),
      label: z.string().min(1).optional(),
      config: z.record(z.string(), z.unknown()).optional().describe("config fields, merged over the type's defaults"),
      inputs: z.array(z.string()).optional().describe("node ids to wire into the new node's input, in order"),
      position: z.object({ x: z.number(), y: z.number() }).optional().describe("canvas position; omit to auto-place"),
    })
    .strict(),
  z.object({ op: z.literal("remove_node"), node: z.string() }).strict(),
  z
    .object({
      op: z.literal("connect"),
      from: z.string(),
      to: z.string(),
      fromPort: z.string().optional(),
      toPort: z.string().optional(),
    })
    .strict(),
  z.object({ op: z.literal("disconnect"), from: z.string(), to: z.string() }).strict(),
  z
    .object({
      op: z.literal("set_config"),
      node: z.string(),
      config: z.record(z.string(), z.unknown()).describe("fields to change; omitted fields keep their value"),
    })
    .strict(),
  z.object({ op: z.literal("rename"), node: z.string(), label: z.string().min(1) }).strict(),
]);
export type GraphEdit = z.infer<typeof GraphEditSchema>;

export const ViewEditSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("link"), node: z.string(), type: CoordinationTypeSchema, scope: ScopeSchema }).strict(),
  z.object({ op: z.literal("unlink"), node: z.string(), type: CoordinationTypeSchema }).strict(),
  z
    .object({
      op: z.literal("set_value"),
      type: z.enum(["focus", "colorBy", "viewSync", "ordering"]),
      scope: ScopeSchema,
      value: z.unknown().describe("focus: row index or null; colorBy: column or null; ordering: {col, dir} or null"),
    })
    .strict(),
  z
    .object({
      op: z.literal("set_filter"),
      scope: ScopeSchema,
      source: z
        .string()
        .min(1)
        .describe("your source key in the crossfilter, e.g. `agent`; members never see their own"),
      where: FilterClauseSchema.nullable().describe("typed clause, or null to remove this source's clause"),
    })
    .strict(),
  z.object({ op: z.literal("show"), node: z.string(), title: z.string().optional() }).strict(),
  z.object({ op: z.literal("hide"), node: z.string() }).strict(),
]);
export type ViewEdit = z.infer<typeof ViewEditSchema>;

export class WorkspaceEditError extends Error {
  readonly index: number;
  constructor(index: number, message: string) {
    super(message);
    this.index = index;
  }
}

/** Highest trailing integer across ids like `filter-3` / `e7` (0 if none). */
function maxSeq(ids: Iterable<string>): number {
  let max = 0;
  for (const id of ids) max = Math.max(max, Number(/(\d+)$/.exec(id)?.[1] ?? 0));
  return max;
}

function requireNode(document: WorkspaceDocument, id: string): GraphDocumentNode {
  const node = document.nodes[id];
  if (!node) throw new Error(`no node "${id}"; get_workspace lists node ids`);
  return node;
}

function requireDefinition(resolver: ServerNodeResolver, node: GraphDocumentNode): ServerNodeDefinition {
  const definition = resolver.getSpecExact(node.definitionRef)?.definition;
  if (!definition) throw new Error(`node "${node.id}" has a type the server cannot resolve`);
  return definition;
}

// ponytail: the server knows positions but not rendered sizes, so auto-placement assumes a full-form
// footprint for every node; send real sizes from the browser if agent-placed nodes still overlap.
const CARD = { w: 340, h: 340, gap: 60 };

function freePosition(document: WorkspaceDocument, inputs: readonly string[]): WorkspaceNodePosition {
  const occupied = Object.values(document.positions);
  const anchors = inputs.map((id) => document.positions[id]).filter((p) => p !== undefined);
  const x =
    anchors.length > 0
      ? Math.max(...anchors.map((p) => p.x)) + CARD.w + CARD.gap
      : Math.max(0, ...occupied.map((p) => p.x)) + CARD.w + CARD.gap;
  let y = anchors[0]?.y ?? 0;
  while (occupied.some((p) => Math.abs(p.x - x) < CARD.w && Math.abs(p.y - y) < CARD.h)) y += CARD.h + CARD.gap / 2;
  return { x, y };
}

function connect(
  document: WorkspaceDocument,
  resolver: ServerNodeResolver,
  from: string,
  to: string,
  fromPort?: string,
  toPort?: string,
): WorkspaceDocument {
  const source = requireDefinition(resolver, requireNode(document, from));
  const target = requireDefinition(resolver, requireNode(document, to));
  const output = fromPort ? source.outputs.find((port) => port.id === fromPort) : source.outputs[0];
  if (!output) throw new Error(`node "${from}" has no output${fromPort ? ` "${fromPort}"` : ""}`);
  const input = toPort
    ? target.inputs.find((port) => port.id === toPort)
    : target.inputs.find((port) => port.kind === output.kind);
  if (!input) throw new Error(`node "${to}" has no input${toPort ? ` "${toPort}"` : ""} that accepts "${output.kind}"`);
  const edges = Object.values(document.edges);
  if (edges.some((e) => e.from === from && e.fromPort === output.id && e.to === to && e.toPort === input.id)) {
    throw new Error(`"${from}" is already wired to "${to}"`);
  }
  const id = `e${maxSeq(Object.keys(document.edges)) + 1}`;
  const edge: GraphDocumentEdge = { id, from, fromPort: output.id, to, toPort: input.id, kind: output.kind };
  return { ...document, edges: { ...document.edges, [id]: edge } };
}

function applyGraphEdit(document: WorkspaceDocument, edit: GraphEdit, resolver: ServerNodeResolver): WorkspaceDocument {
  switch (edit.op) {
    case "add_node": {
      const definition = resolver.definitions.find((candidate) => candidate.ref.nodeTypeId === edit.type);
      if (!definition) throw new Error(`unknown node type "${edit.type}"; list_node_types lists them`);
      if (NOT_ADDABLE.has(edit.type)) throw new Error(`node type "${edit.type}" cannot be added by agents`);
      const id = edit.id ?? `${edit.type}-${maxSeq(Object.keys(document.nodes)) + 1}`;
      if (document.nodes[id]) throw new Error(`node id "${id}" is taken`);
      const inputs = edit.inputs ?? [];
      for (const input of inputs) requireNode(document, input);
      let node: GraphDocumentNode = {
        id,
        definitionRef: definition.ref,
        label: edit.label ?? definition.title,
        parent: inputs.length > 0 ? (document.nodes[inputs[0]].parent ?? null) : null,
      };
      if (edit.config) node = patchNodeConfig(node, edit.config, definition.config);
      let next: WorkspaceDocument = {
        ...document,
        nodes: { ...document.nodes, [id]: node },
        positions: { ...document.positions, [id]: edit.position ?? freePosition(document, inputs) },
      };
      for (const input of inputs) next = connect(next, resolver, input, id);
      return next;
    }
    case "remove_node": {
      const node = requireNode(document, edit.node);
      if (NOT_ADDABLE.has(node.definitionRef.nodeTypeId)) {
        throw new Error(`node "${edit.node}" (${node.definitionRef.nodeTypeId}) cannot be removed by agents`);
      }
      const nodes = { ...document.nodes };
      delete nodes[edit.node];
      const positions = { ...document.positions };
      delete positions[edit.node];
      const flags = { ...document.flags };
      delete flags[edit.node];
      const edges = Object.fromEntries(
        Object.entries(document.edges).filter(([, e]) => e.from !== edit.node && e.to !== edit.node),
      );
      const stage = removeNodeView(document.stage, edit.node);
      return withoutNodeCoordination({ ...document, nodes, positions, flags, edges, stage }, edit.node);
    }
    case "connect":
      return connect(document, resolver, edit.from, edit.to, edit.fromPort, edit.toPort);
    case "disconnect": {
      const edges = Object.fromEntries(
        Object.entries(document.edges).filter(([, e]) => !(e.from === edit.from && e.to === edit.to)),
      );
      if (Object.keys(edges).length === Object.keys(document.edges).length) {
        throw new Error(`no wire from "${edit.from}" to "${edit.to}"`);
      }
      return { ...document, edges };
    }
    case "set_config": {
      const node = requireNode(document, edit.node);
      const next = patchNodeConfig(node, edit.config, requireDefinition(resolver, node).config);
      return { ...document, nodes: { ...document.nodes, [edit.node]: next } };
    }
    case "rename": {
      const node = requireNode(document, edit.node);
      return { ...document, nodes: { ...document.nodes, [edit.node]: { ...node, label: edit.label } } };
    }
  }
}

function applyViewEdit(document: WorkspaceDocument, edit: ViewEdit, resolver: ServerNodeResolver): WorkspaceDocument {
  let draft = document;
  const coordination = createCoordination({
    snapshot: () => draft,
    update: (mutator) => {
      draft = { ...draft, ...mutator(draft) };
    },
    subscribe: () => () => {},
  });
  switch (edit.op) {
    case "link": {
      const node = requireNode(document, edit.node);
      const { capability, label } = COORDINATION_TYPES[edit.type];
      if (!requireDefinition(resolver, node).capabilities.includes(capability)) {
        throw new Error(`node "${edit.node}" (${node.definitionRef.nodeTypeId}) cannot join a ${label} scope`);
      }
      coordination.assignScope(edit.node, edit.type, edit.scope);
      return draft;
    }
    case "unlink":
      requireNode(document, edit.node);
      if (coordination.scopeOf(edit.node, edit.type) === undefined) {
        throw new Error(`node "${edit.node}" is not linked to a ${edit.type} scope`);
      }
      coordination.clearScope(edit.node, edit.type);
      return draft;
    case "set_value":
      setCell(coordination, edit.type, edit.scope, edit.value);
      return draft;
    case "set_filter": {
      const cell = { ...coordination.readCoordination("filter", edit.scope) };
      if (edit.where) cell[edit.source] = { where: edit.where satisfies FilterClause };
      else delete cell[edit.source];
      coordination.setCoordinationValue("filter", edit.scope, cell);
      return draft;
    }
    case "show": {
      requireNode(document, edit.node);
      const stage = addView(document.stage, edit.node);
      const view = stageViews(stage).get(edit.node)!;
      if (edit.title === undefined) return { ...document, stage };
      const element = stage!.elements[view];
      if (element.type !== "View") return { ...document, stage };
      const titled = { ...element, props: { ...element.props, title: edit.title } };
      return { ...document, stage: { ...stage!, elements: { ...stage!.elements, [view]: titled } } };
    }
    case "hide":
      if (!stageViews(document.stage).has(edit.node)) throw new Error(`node "${edit.node}" is not on the Stage`);
      return { ...document, stage: removeNodeView(document.stage, edit.node) };
  }
}

function setCell(
  coordination: CoordinationScopeCellPort,
  type: Exclude<CoordinationTypeId, "filter">,
  scope: string,
  value: unknown,
): void {
  const parsed = COORDINATION_TYPES[type].value.safeParse(value);
  if (!parsed.success) throw new Error(`invalid ${type} value: ${parsed.error.issues[0]?.message ?? "rejected"}`);
  coordination.setCoordinationValue(type, scope, parsed.data);
}

/** Apply `edits` in order; throws `WorkspaceEditError` at the first op that cannot apply. */
export function applyWorkspaceEdits(
  document: WorkspaceDocument,
  edits: readonly (GraphEdit | ViewEdit)[],
  resolver: ServerNodeResolver,
): WorkspaceDocument {
  let next = document;
  edits.forEach((edit, index) => {
    try {
      next = isGraphEdit(edit) ? applyGraphEdit(next, edit, resolver) : applyViewEdit(next, edit, resolver);
    } catch (error) {
      throw new WorkspaceEditError(index, error instanceof Error ? error.message : String(error));
    }
  });
  return next;
}

const GRAPH_OPS = new Set<string>(["add_node", "remove_node", "connect", "disconnect", "set_config", "rename"]);
function isGraphEdit(edit: GraphEdit | ViewEdit): edit is GraphEdit {
  return GRAPH_OPS.has(edit.op);
}
