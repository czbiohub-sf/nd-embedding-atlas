/**
 * Named dashboard edits for agents. Each op runs against a draft of the
 * document through the same pure dashboard operations the browser uses; the
 * caller diffs the draft against the base into one RFC 6902 patch, so every
 * edit still meets the one validated write path (`Workspace.patch`). An op
 * that cannot apply throws `WorkspaceEditError` naming it; everything the
 * document schema checks (component props, data references, bind rules) is
 * left to that write path.
 */

import { FilterClauseSchema } from "@ndea/protocol";
import { z } from "zod";

import {
  bindingPointer,
  COORDINATION_TYPE_IDS,
  COORDINATION_TYPES,
  type CoordinationState,
} from "../frontend/core/coordination/types.ts";
import {
  COMPONENTS,
  elementScope,
  freshElementId,
  parentOf,
  removeElement,
  setElementProps,
  splitElement,
  swapElements,
  type Dashboard,
  type DashboardElement,
} from "../frontend/core/workspace/dashboard.ts";
import { dataSourceSchema } from "../frontend/core/workspace/data-sources.ts";
import type { WorkspaceDocument } from "../frontend/core/workspace/types.ts";

const IdSchema = z.string().min(1);
const ScopeSchema = z.string().regex(/^[A-Za-z0-9_-]+$/, "scope names use letters, digits, _ and -");
const CoordinationTypeSchema = z.enum(COORDINATION_TYPE_IDS);
const PropsSchema = z.record(z.string(), z.json());

const AtSchema = z.union([
  z.object({ slot: IdSchema }).strict().describe("fill this empty slot"),
  z
    .object({ stack: IdSchema, index: z.number().int().nonnegative().optional() })
    .strict()
    .describe("insert into this stack's children at `index` (default: last)"),
  z
    .object({ beside: IdSchema, side: z.enum(["left", "right", "up", "down"]).optional() })
    .strict()
    .describe("split this element in two; the new element takes `side` (default: right)"),
]);

export const DashboardEditSchema = z.discriminatedUnion("op", [
  z
    .object({ op: z.literal("set_data"), name: z.string(), source: dataSourceSchema })
    .describe("add or replace a data source"),
  z.object({ op: z.literal("remove_data"), name: z.string() }),
  z.object({
    op: z.literal("add"),
    type: z.string().describe("component type from list_components"),
    id: IdSchema.optional().describe("id for the new element (default <type>-<n>); later ops may reference it"),
    props: PropsSchema.optional().describe("data, title, coordination bindings, and the component's config"),
    at: AtSchema.optional().describe("default: fill the root if it is an empty slot, else split the root to its right"),
  }),
  z.object({
    op: z.literal("set_props"),
    id: IdSchema,
    props: PropsSchema.describe("merged into the element's props; null removes a key"),
  }),
  z.object({ op: z.literal("remove"), id: IdSchema }),
  z.object({ op: z.literal("swap"), a: IdSchema, b: IdSchema }),
  z.object({ op: z.literal("bind"), id: IdSchema, type: CoordinationTypeSchema, scope: ScopeSchema }),
  z.object({ op: z.literal("unbind"), id: IdSchema, type: CoordinationTypeSchema }),
  z.object({
    op: z.literal("set_filter"),
    scope: ScopeSchema,
    source: z.string().min(1).describe("your own source key, e.g. 'agent'; never another element's id"),
    facet: z.string().min(1),
    clause: FilterClauseSchema.nullable().describe("null removes the clause"),
  }),
]);
export type DashboardEdit = z.infer<typeof DashboardEditSchema>;

export class WorkspaceEditError extends Error {
  readonly index: number;
  constructor(index: number, message: string) {
    super(message);
    this.index = index;
  }
}

function requireElement(spec: Dashboard, id: string): DashboardElement {
  const element = Object.hasOwn(spec.elements, id) ? spec.elements[id] : undefined;
  if (!element) throw new Error(`no element "${id}"; get_workspace lists element ids`);
  return element;
}

/** Put `element` under `id` where the slot `slot` was. */
function replaceSlot(spec: Dashboard, slot: string, id: string, element: DashboardElement): Dashboard {
  const parent = parentOf(spec, slot);
  const { [slot]: _slot, ...elements } = spec.elements;
  elements[id] = element;
  if (parent !== undefined) {
    elements[parent] = { ...elements[parent], children: elements[parent].children.map((c) => (c === slot ? id : c)) };
  }
  return { root: spec.root === slot ? id : spec.root, elements };
}

/** Drop one source's clauses from a filter scope: an element's own contribution. */
function dropFilterSource(state: CoordinationState, scope: string | undefined, source: string): void {
  if (scope !== undefined && state.filter?.[scope]) delete state.filter[scope][source];
}

function addElement(spec: Dashboard, edit: Extract<DashboardEdit, { op: "add" }>): Dashboard {
  if (!Object.hasOwn(COMPONENTS, edit.type)) {
    throw new Error(`unknown component "${edit.type}"; list_components lists them`);
  }
  const element: DashboardElement = { type: edit.type, props: edit.props ?? {}, children: [] };
  const freshId = (base: Dashboard): string => {
    const id = edit.id ?? freshElementId(base, edit.type);
    if (Object.hasOwn(base.elements, id)) throw new Error(`element id "${id}" is taken`);
    return id;
  };
  const at: z.infer<typeof AtSchema> =
    edit.at ?? (spec.elements[spec.root].type === "slot" ? { slot: spec.root } : { beside: spec.root });
  if ("stack" in at) {
    const stack = requireElement(spec, at.stack);
    if (stack.type !== "stack") throw new Error(`element "${at.stack}" is not a stack`);
    const id = freshId(spec);
    const children = stack.children.toSpliced(at.index ?? stack.children.length, 0, id);
    return { ...spec, elements: { ...spec.elements, [id]: element, [at.stack]: { ...stack, children } } };
  }
  if ("slot" in at) {
    if (requireElement(spec, at.slot).type !== "slot") throw new Error(`element "${at.slot}" is not an empty slot`);
    return replaceSlot(spec, at.slot, freshId(spec), element);
  }
  requireElement(spec, at.beside);
  const [split, slot] = splitElement(spec, at.beside, at.side ?? "right");
  return replaceSlot(split, slot!, freshId(split), element);
}

function applyEdit(draft: WorkspaceDocument, edit: DashboardEdit): void {
  switch (edit.op) {
    case "set_data":
      draft.data[edit.name] = edit.source;
      return;
    case "remove_data":
      if (!Object.hasOwn(draft.data, edit.name)) throw new Error(`no data source "${edit.name}"`);
      delete draft.data[edit.name];
      return;
    case "add":
      draft.spec = addElement(draft.spec, edit);
      return;
    case "set_props": {
      requireElement(draft.spec, edit.id);
      const patch = Object.fromEntries(Object.entries(edit.props).map(([key, value]) => [key, value ?? undefined]));
      draft.spec = setElementProps(draft.spec, edit.id, patch);
      return;
    }
    case "remove": {
      requireElement(draft.spec, edit.id);
      const next = removeElement(draft.spec, edit.id);
      for (const [id, element] of Object.entries(draft.spec.elements)) {
        if (!Object.hasOwn(next.elements, id)) dropFilterSource(draft.state, elementScope(element, "filter"), id);
      }
      draft.spec = next;
      return;
    }
    case "swap": {
      requireElement(draft.spec, edit.a);
      requireElement(draft.spec, edit.b);
      const next = swapElements(draft.spec, edit.a, edit.b);
      if (next === draft.spec)
        throw new Error(`cannot swap "${edit.a}" with "${edit.b}": same element or one contains the other`);
      draft.spec = next;
      return;
    }
    case "bind": {
      const element = requireElement(draft.spec, edit.id);
      const previous = elementScope(element, "filter");
      if (edit.type === "filter" && previous !== edit.scope) dropFilterSource(draft.state, previous, edit.id);
      draft.spec = setElementProps(draft.spec, edit.id, {
        [edit.type]: { $bindState: bindingPointer(edit.type, edit.scope) },
      });
      // Each type's cells hold that type's values; its `defaultValue` is one of them.
      const state = draft.state as Record<string, Record<string, unknown> | undefined>;
      const cells = (state[edit.type] ??= {});
      if (!Object.hasOwn(cells, edit.scope))
        cells[edit.scope] = structuredClone(COORDINATION_TYPES[edit.type].defaultValue);
      return;
    }
    case "unbind": {
      const element = requireElement(draft.spec, edit.id);
      if (!(edit.type in element.props)) throw new Error(`element "${edit.id}" is not bound to ${edit.type}`);
      if (edit.type === "filter") dropFilterSource(draft.state, elementScope(element, "filter"), edit.id);
      draft.spec = setElementProps(draft.spec, edit.id, { [edit.type]: undefined });
      return;
    }
    case "set_filter": {
      const cell = draft.state.filter?.[edit.scope];
      if (edit.clause === null) {
        if (!cell?.[edit.source]) return;
        delete cell[edit.source][edit.facet];
        if (Object.keys(cell[edit.source]).length === 0) delete cell[edit.source];
        return;
      }
      const filter = (draft.state.filter ??= {});
      ((filter[edit.scope] ??= {})[edit.source] ??= {})[edit.facet] = edit.clause;
      return;
    }
  }
}

/** Apply `edits` in order to a draft; throws `WorkspaceEditError` at the first op that cannot apply. */
export function applyDashboardEdits(document: WorkspaceDocument, edits: readonly DashboardEdit[]): WorkspaceDocument {
  const draft = structuredClone(document);
  edits.forEach((edit, index) => {
    try {
      applyEdit(draft, edit);
    } catch (error) {
      throw new WorkspaceEditError(index, error instanceof Error ? error.message : String(error));
    }
  });
  return draft;
}
