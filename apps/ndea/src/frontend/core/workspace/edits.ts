/**
 * Named dashboard edits: the one edit vocabulary of agents and the browser.
 * Each op runs against a draft of the document through the pure per-section
 * helpers (`dashboard.ts` for layouts, `coordination/types.ts` for cells);
 * the caller diffs the draft against the base into one RFC 6902 patch, so
 * every edit still meets the one validated write path (`Workspace.patch`). An
 * op that cannot apply throws `WorkspaceEditError` naming it; everything the
 * document schema checks (component props, data references, bind rules) is
 * left to that write path. Element ops find the layout holding their element.
 * Changes that span sections (an element's layout and its coordination
 * cells, a removal and its filter contributions) live only here.
 */

import { FilterClauseSchema } from "@ndea/protocol";
import { z } from "zod";

import {
  bindingPointer,
  COORDINATION_TYPE_IDS,
  COORDINATION_TYPES,
  type CoordinationState,
  type CoordinationTypeId,
} from "../coordination/types.ts";
import {
  allElements,
  closeTab,
  COMPONENTS,
  elementScope,
  elementTitle,
  emptyDashboard,
  findElement,
  freshElementId,
  freshId,
  insertTab,
  layoutOf,
  moveTab,
  parentOf,
  removeElement,
  renameElements,
  setElementProps,
  splitElement,
  swapElements,
  takenIds,
  type Dashboard,
  type DashboardElement,
  type LayoutDocument,
  type SplitSide,
} from "./dashboard.ts";
import { dataSourceSchema } from "./data-sources.ts";
import type { WorkspaceDocument } from "./types.ts";

const IdSchema = z.string().min(1).describe("an element id or its reference ndea://<workspace>/<id>");
const LayoutIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, "layout ids use letters, digits, _ and -");
const ScopeSchema = z.string().regex(/^[A-Za-z0-9_-]+$/, "scope names use letters, digits, _ and -");
const CoordinationTypeSchema = z.enum(COORDINATION_TYPE_IDS);
const PropsSchema = z.record(z.string(), z.json());

const SideSchema = z.enum(["left", "right", "up", "down"]);

const AtSchema = z.union([
  z.object({ slot: IdSchema }).strict().describe("fill this empty slot"),
  z
    .object({ stack: IdSchema, index: z.number().int().nonnegative().optional() })
    .strict()
    .describe("insert into this stack's children at `index` (default: last)"),
  z
    .object({ beside: IdSchema, side: SideSchema.optional() })
    .strict()
    .describe("split this element in two; the new element takes `side` (default: right)"),
]);

export const DashboardEditSchema = z.discriminatedUnion("op", [
  z
    .object({ op: z.literal("set_data"), name: z.string(), source: dataSourceSchema })
    .describe("add or replace a data source"),
  z.object({ op: z.literal("remove_data"), name: z.string() }).describe("remove a data source"),
  z
    .object({
      op: z.literal("add"),
      type: z.string().describe("component type from list_components"),
      id: IdSchema.optional().describe("id for the new element (default <type>-<n>); later ops may reference it"),
      props: PropsSchema.optional().describe("data, title, coordination bindings, and the component's config"),
      at: AtSchema.optional().describe(
        "default: fill the root if it is an empty slot, else split the root to its right",
      ),
      layout: LayoutIdSchema.optional().describe(
        "layout to add to (default: the one holding `at`, else the active one)",
      ),
    })
    .describe(
      "place a new element in `layout` (default: the layout holding `at`, else the active one): at {slot} fills an empty slot, {stack, index?} inserts into a stack, {beside, side?: left|right|up|down} splits that element's tile (default: fill an empty root slot, else split the root to its right)",
    ),
  z
    .object({
      op: z.literal("set_props"),
      id: IdSchema,
      props: PropsSchema.describe("merged into the element's props; null removes a key"),
    })
    .describe("merge props into an element (null removes a key)"),
  z.object({ op: z.literal("remove"), id: IdSchema }).describe("remove an element"),
  z
    .object({
      op: z.literal("split"),
      id: IdSchema.describe("the element to split; a tab splits its tile"),
      side: SideSchema.optional().describe("where the new empty tile goes (default: right)"),
      slot: IdSchema.optional().describe("id for the new empty tile (default slot-<n>); later ops may reference it"),
    })
    .describe(
      "split an element (a tab: its tile) in two, leaving a new empty tile on `side` (left|right|up|down, default right) with id `slot`; set the split's ratio with set_props",
    ),
  z.object({ op: z.literal("swap"), a: IdSchema, b: IdSchema }).describe("swap two tiles"),
  z
    .object({ op: z.literal("bind"), id: IdSchema, type: CoordinationTypeSchema, scope: ScopeSchema })
    .describe("set the element's {$bindState} prop for `type`, creating the link (scope) if needed"),
  z
    .object({ op: z.literal("unbind"), id: IdSchema, type: CoordinationTypeSchema })
    .describe("drop the element's binding for `type` and its own filter clauses"),
  z
    .object({
      op: z.literal("set_filter"),
      scope: ScopeSchema,
      source: z.string().min(1).describe("your own source key, e.g. 'agent'; never another element's id"),
      facet: z.string().min(1),
      clause: FilterClauseSchema.nullable().describe("null removes the clause"),
    })
    .describe(
      "write your own crossfilter clause under your source key (null removes it); every member of the link sees it",
    ),
  z
    .object({
      op: z.literal("add_tab"),
      tile: IdSchema.describe("a tabs tile, one of its tabs, a bare view (wrapped in tabs), or an empty slot"),
      type: z.string().describe("a view component type from list_components"),
      props: PropsSchema.optional(),
      id: IdSchema.optional().describe("id for the new view (default <type>-<n>)"),
    })
    .describe(
      "add a view as the tile's new, active tab (a bare view tile is wrapped in tabs; an empty tile is filled)",
    ),
  z
    .object({
      op: z.literal("move_tab"),
      id: IdSchema.describe("the view to move"),
      to: IdSchema.describe(
        "target tile in the same layout: a tabs tile, one of its tabs, a bare view, or an empty slot",
      ),
      index: z.number().int().nonnegative().optional().describe("position among the target's tabs (default: last)"),
    })
    .describe(
      "move a view into another tile of the same layout as its active tab; its old tile keeps the rest (or becomes empty)",
    ),
  z
    .object({ op: z.literal("close_tab"), id: IdSchema })
    .describe("remove a view from its tile; closing a tile's last tab leaves an empty tile"),
  z.object({ op: z.literal("set_active_tab"), tile: IdSchema, id: IdSchema }).describe("show tab `id` in `tile`"),
  z
    .object({
      op: z.literal("add_layout"),
      id: LayoutIdSchema.optional().describe("default layout-<n>"),
      name: z.string().min(1),
      from: LayoutIdSchema.optional().describe("layout to duplicate (fresh element ids); omit for one empty tile"),
    })
    .describe(
      "add a named layout (`from` duplicates that layout with fresh element ids; omitted: one empty tile); it does not become active (set_active_layout)",
    ),
  z.object({ op: z.literal("rename_layout"), id: LayoutIdSchema, name: z.string().min(1) }).describe("rename a layout"),
  z.object({ op: z.literal("remove_layout"), id: LayoutIdSchema }).describe("remove a layout (never the last one)"),
  z.object({ op: z.literal("set_active_layout"), id: LayoutIdSchema }).describe("show this layout"),
]);
export type DashboardEdit = z.infer<typeof DashboardEditSchema>;

export class WorkspaceEditError extends Error {
  readonly index: number;
  constructor(index: number, message: string) {
    super(message);
    this.index = index;
  }
}

/** `ndea://<workspace>/<element-id>`: a pasteable pointer to one view. */
export function elementReference(workspace: string, id: string): string {
  return `ndea://${workspace}/${id}`;
}

/** A bare element id, or the id a reference into `workspace` names; throws for another workspace's reference. */
export function resolveElementId(value: string, workspace: string): string {
  const match = /^ndea:\/\/([^/]+)\/(.+)$/.exec(value);
  if (!match) return value;
  if (match[1] !== workspace)
    throw new Error(`${value} names workspace "${match[1]}"; this is "${workspace}" (ndea://${workspace}/<id>)`);
  return match[2];
}

/** Resolve every existing-element id in `edits` (references allowed); throws `WorkspaceEditError` naming the op. */
export function resolveEditReferences(edits: readonly DashboardEdit[], workspace: string): DashboardEdit[] {
  return edits.map((edit, index) => {
    const id = (value: string) => {
      try {
        return resolveElementId(value, workspace);
      } catch (error) {
        throw new WorkspaceEditError(index, (error as Error).message);
      }
    };
    switch (edit.op) {
      case "set_props":
      case "remove":
      case "split":
      case "bind":
      case "unbind":
      case "close_tab":
        return { ...edit, id: id(edit.id) };
      case "swap":
        return { ...edit, a: id(edit.a), b: id(edit.b) };
      case "move_tab":
        return { ...edit, id: id(edit.id), to: id(edit.to) };
      case "add_tab":
        return { ...edit, tile: id(edit.tile) };
      case "set_active_tab":
        return { ...edit, tile: id(edit.tile), id: id(edit.id) };
      case "add": {
        const at = edit.at;
        if (!at) return edit;
        if ("slot" in at) return { ...edit, at: { ...at, slot: id(at.slot) } };
        if ("stack" in at) return { ...edit, at: { ...at, stack: id(at.stack) } };
        return { ...edit, at: { ...at, beside: id(at.beside) } };
      }
      default:
        return edit;
    }
  });
}

function requireElement(spec: Dashboard, id: string): DashboardElement {
  const element = Object.hasOwn(spec.elements, id) ? spec.elements[id] : undefined;
  if (!element) throw new Error(`no element "${id}"; get_workspace lists element ids`);
  return element;
}

/** The layout holding element `id`. */
function holder(draft: WorkspaceDocument, id: string): string {
  const layout = layoutOf(draft, id);
  if (layout === undefined) throw new Error(`no element "${id}"; get_workspace lists element ids`);
  return layout;
}

function requireLayout(draft: WorkspaceDocument, id: string): void {
  if (!Object.hasOwn(draft.layouts, id)) {
    throw new Error(`no layout "${id}"; layouts: ${Object.keys(draft.layouts).join(", ")}`);
  }
}

/** The tile `id` sits in: its `tabs` when it is a tab, else itself; a tabs, view, or empty tile. */
function requireTile(spec: Dashboard, id: string): string {
  const parent = parentOf(spec, id);
  const tile = parent !== undefined && spec.elements[parent].type === "tabs" ? parent : id;
  const { type } = requireElement(spec, tile);
  if (type !== "tabs" && type !== "slot" && !COMPONENTS[type]?.view) {
    throw new Error(`element "${id}" (${type}) is not a tile; tiles are tabs, views, and empty slots`);
  }
  return tile;
}

function requireView(spec: Dashboard, id: string): void {
  const { type } = requireElement(spec, id);
  if (!COMPONENTS[type]?.view) throw new Error(`element "${id}" (${type}) is not a view; tabs hold views`);
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

/** What splitting `id` splits: beside a tab means beside its tile. */
function splitTarget(spec: Dashboard, id: string): string {
  requireElement(spec, id);
  const parent = parentOf(spec, id);
  return parent !== undefined && spec.elements[parent].type === "tabs" ? parent : id;
}

/** `state` without element `id`'s own clauses in filter scope `scope`: its crossfilter contribution. */
function withoutContribution(state: CoordinationState, scope: string | undefined, id: string): CoordinationState {
  const cell = scope === undefined ? undefined : state.filter?.[scope];
  if (!cell || !Object.hasOwn(cell, id)) return state;
  const { [id]: _dropped, ...rest } = cell;
  return { ...state, filter: { ...state.filter, [scope!]: rest } };
}

/** Elements of `before` gone from `after` (any layout) take their filter contributions with them. */
function withoutRemoved(
  state: CoordinationState,
  before: readonly [string, DashboardElement][],
  after: LayoutDocument,
): CoordinationState {
  const kept = takenIds(after);
  return before.reduce(
    (next, [id, element]) => (kept.has(id) ? next : withoutContribution(next, elementScope(element, "filter"), id)),
    state,
  );
}

/**
 * `next` without the filter contributions of `previous`'s elements it no
 * longer has, so peers stop seeing them. Every op settles this itself; the
 * browser also settles documents it adopts (a remote raw patch may remove).
 */
export function withoutRemovedContributions(previous: WorkspaceDocument, next: WorkspaceDocument): WorkspaceDocument {
  const state = withoutRemoved(next.state, allElements(previous), next);
  return state === next.state ? next : { ...next, state };
}

/** Create the scope's cell at its default if missing: a new member's scopes exist from the start. */
function ensureCell(state: CoordinationState, type: CoordinationTypeId, scope: string): void {
  // Each type's cells hold that type's values; its `defaultValue` is one of them.
  const cells = ((state as Record<string, Record<string, unknown> | undefined>)[type] ??= {});
  if (!Object.hasOwn(cells, scope)) cells[scope] = structuredClone(COORDINATION_TYPES[type].defaultValue);
}

/** Cells for every scope a new element's props bind. */
function ensureCells(state: CoordinationState, element: DashboardElement): void {
  for (const type of COORDINATION_TYPE_IDS) {
    const scope = elementScope(element, type);
    if (scope !== undefined) ensureCell(state, type, scope);
  }
}

/** Claim `id` (or a fresh `<type>-<n>`) for a new element; ids are unique across layouts. */
function newId(spec: Dashboard, requested: string | undefined, type: string, reserved: ReadonlySet<string>): string {
  const id = requested ?? freshElementId(spec, type, reserved);
  if (Object.hasOwn(spec.elements, id) || reserved.has(id)) throw new Error(`element id "${id}" is taken`);
  return id;
}

function addElement(
  spec: Dashboard,
  edit: Extract<DashboardEdit, { op: "add" }>,
  element: DashboardElement,
  reserved: ReadonlySet<string>,
): Dashboard {
  const at: z.infer<typeof AtSchema> =
    edit.at ?? (spec.elements[spec.root].type === "slot" ? { slot: spec.root } : { beside: spec.root });
  if ("stack" in at) {
    const stack = requireElement(spec, at.stack);
    if (stack.type !== "stack") throw new Error(`element "${at.stack}" is not a stack`);
    const id = newId(spec, edit.id, edit.type, reserved);
    const children = stack.children.toSpliced(at.index ?? stack.children.length, 0, id);
    return { ...spec, elements: { ...spec.elements, [id]: element, [at.stack]: { ...stack, children } } };
  }
  if ("slot" in at) {
    if (requireElement(spec, at.slot).type !== "slot") throw new Error(`element "${at.slot}" is not an empty slot`);
    return replaceSlot(spec, at.slot, newId(spec, edit.id, edit.type, reserved), element);
  }
  const [split, slot] = splitElement(spec, splitTarget(spec, at.beside), at.side ?? "right", reserved);
  return replaceSlot(split, slot!, newId(split, edit.id, edit.type, reserved), element);
}

function applyEdit(draft: WorkspaceDocument, edit: DashboardEdit): void {
  const spec = (layout: string) => draft.layouts[layout].spec;
  const update = (layout: string, next: Dashboard) => {
    draft.layouts[layout].spec = next;
  };
  switch (edit.op) {
    case "set_data":
      draft.data[edit.name] = edit.source;
      return;
    case "remove_data":
      if (!Object.hasOwn(draft.data, edit.name)) throw new Error(`no data source "${edit.name}"`);
      delete draft.data[edit.name];
      return;
    case "add": {
      if (!Object.hasOwn(COMPONENTS, edit.type)) {
        throw new Error(`unknown component "${edit.type}"; list_components lists them`);
      }
      const target =
        edit.at && ("slot" in edit.at ? edit.at.slot : "stack" in edit.at ? edit.at.stack : edit.at.beside);
      const layout = edit.layout ?? (target === undefined ? draft.layout : holder(draft, target));
      requireLayout(draft, layout);
      const element: DashboardElement = { type: edit.type, props: edit.props ?? {}, children: [] };
      update(layout, addElement(spec(layout), edit, element, takenIds(draft)));
      ensureCells(draft.state, element);
      return;
    }
    case "set_props": {
      const layout = holder(draft, edit.id);
      const patch = Object.fromEntries(Object.entries(edit.props).map(([key, value]) => [key, value ?? undefined]));
      update(layout, setElementProps(spec(layout), edit.id, patch));
      return;
    }
    case "remove": {
      const layout = holder(draft, edit.id);
      update(layout, removeElement(spec(layout), edit.id, takenIds(draft)));
      return;
    }
    case "split": {
      const layout = holder(draft, edit.id);
      const reserved = takenIds(draft);
      const slot = newId(spec(layout), edit.slot, "slot", reserved);
      const target = splitTarget(spec(layout), edit.id);
      update(layout, splitElement(spec(layout), target, edit.side ?? "right", reserved.add(slot), slot)[0]);
      return;
    }
    case "swap": {
      const layout = holder(draft, edit.a);
      if (holder(draft, edit.b) !== layout) throw new Error(`"${edit.a}" and "${edit.b}" are in different layouts`);
      const next = swapElements(spec(layout), edit.a, edit.b);
      if (next === spec(layout))
        throw new Error(`cannot swap "${edit.a}" with "${edit.b}": same element or one contains the other`);
      update(layout, next);
      return;
    }
    case "bind": {
      const layout = holder(draft, edit.id);
      const previous = elementScope(spec(layout).elements[edit.id], "filter");
      if (edit.type === "filter" && previous !== edit.scope) {
        draft.state = withoutContribution(draft.state, previous, edit.id);
      }
      update(
        layout,
        setElementProps(spec(layout), edit.id, { [edit.type]: { $bindState: bindingPointer(edit.type, edit.scope) } }),
      );
      ensureCell(draft.state, edit.type, edit.scope);
      return;
    }
    case "unbind": {
      const layout = holder(draft, edit.id);
      const element = spec(layout).elements[edit.id];
      if (!(edit.type in element.props)) throw new Error(`element "${edit.id}" is not bound to ${edit.type}`);
      if (edit.type === "filter")
        draft.state = withoutContribution(draft.state, elementScope(element, "filter"), edit.id);
      update(layout, setElementProps(spec(layout), edit.id, { [edit.type]: undefined }));
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
    case "add_tab": {
      const layout = holder(draft, edit.tile);
      const tile = requireTile(spec(layout), edit.tile);
      if (!COMPONENTS[edit.type]?.view) throw new Error(`"${edit.type}" is not a view; list_components lists them`);
      const reserved = takenIds(draft);
      const id = newId(spec(layout), edit.id, edit.type, reserved);
      const element: DashboardElement = { type: edit.type, props: edit.props ?? {}, children: [] };
      const withElement = { ...spec(layout), elements: { ...spec(layout).elements, [id]: element } };
      update(layout, insertTab(withElement, id, tile, undefined, reserved));
      ensureCells(draft.state, element);
      return;
    }
    case "move_tab": {
      const layout = holder(draft, edit.id);
      requireView(spec(layout), edit.id);
      if (holder(draft, edit.to) !== layout) throw new Error(`"${edit.id}" and "${edit.to}" are in different layouts`);
      const tile = requireTile(spec(layout), edit.to);
      if (tile === edit.id) throw new Error(`cannot move "${edit.id}" into itself`);
      update(layout, moveTab(spec(layout), edit.id, tile, edit.index, takenIds(draft)));
      return;
    }
    case "close_tab": {
      const layout = holder(draft, edit.id);
      requireView(spec(layout), edit.id);
      update(layout, closeTab(spec(layout), edit.id, takenIds(draft)));
      return;
    }
    case "set_active_tab": {
      const layout = holder(draft, edit.tile);
      const tile = requireTile(spec(layout), edit.tile);
      const tabs = spec(layout).elements[tile];
      const tabIds = tabs.type === "tabs" ? tabs.children : [tile];
      if (!tabIds.includes(edit.id)) throw new Error(`"${edit.id}" is not a tab of "${tile}"`);
      if (tabs.type === "tabs") update(layout, setElementProps(spec(layout), tile, { active: edit.id }));
      return;
    }
    case "add_layout": {
      const id = edit.id ?? freshId("layout", new Set(Object.keys(draft.layouts)));
      if (Object.hasOwn(draft.layouts, id)) throw new Error(`layout id "${id}" is taken`);
      const reserved = takenIds(draft);
      if (edit.from !== undefined) requireLayout(draft, edit.from);
      const next =
        edit.from === undefined ? emptyDashboard(freshId("slot", reserved)) : renameElements(spec(edit.from), reserved);
      draft.layouts[id] = { name: edit.name, spec: next };
      return;
    }
    case "rename_layout":
      requireLayout(draft, edit.id);
      draft.layouts[edit.id].name = edit.name;
      return;
    case "remove_layout": {
      requireLayout(draft, edit.id);
      const rest = Object.keys(draft.layouts).filter((id) => id !== edit.id);
      if (rest.length === 0) throw new Error(`cannot remove "${edit.id}", the only layout`);
      delete draft.layouts[edit.id];
      if (draft.layout === edit.id) draft.layout = rest[0];
      return;
    }
    case "set_active_layout":
      requireLayout(draft, edit.id);
      draft.layout = edit.id;
      return;
  }
}

/**
 * Apply `edits` in order to a draft; throws `WorkspaceEditError` at the first
 * op that cannot apply. Elements an op removes take their filter
 * contributions with them.
 */
export function applyDashboardEdits(document: WorkspaceDocument, edits: readonly DashboardEdit[]): WorkspaceDocument {
  const draft = structuredClone(document);
  edits.forEach((edit, index) => {
    const before = allElements(draft);
    try {
      applyEdit(draft, edit);
    } catch (error) {
      throw new WorkspaceEditError(index, error instanceof Error ? error.message : String(error));
    }
    draft.state = withoutRemoved(draft.state, before, draft);
  });
  return draft;
}

const componentTitle = (type: string) => COMPONENTS[type]?.title ?? type;
const SIDE_WORDS: Record<SplitSide, string> = { left: "left of", right: "beside", up: "above", down: "below" };

/**
 * One edit in glossary words, e.g. `Add Histogram beside Table`: a proposal
 * change's summary. `document` is the workspace the edit applies to; ids
 * are already resolved (`resolveEditReferences`).
 */
export function describeEdit(edit: DashboardEdit, document: WorkspaceDocument): string {
  /** The element's title; quoted when it is its own, not its component's. */
  const view = (id: string) => {
    const element = findElement(document, id);
    if (!element) return `"${id}"`;
    const title = elementTitle(element);
    return title === componentTitle(element.type) ? title : `"${title}"`;
  };
  const layout = (id: string) => `layout "${document.layouts[id]?.name ?? id}"`;
  switch (edit.op) {
    case "set_data":
      return `${Object.hasOwn(document.data, edit.name) ? "Change" : "Add"} source "${edit.name}"`;
    case "remove_data":
      return `Remove source "${edit.name}"`;
    case "add": {
      const at = !edit.at
        ? ""
        : "slot" in edit.at
          ? " in an empty tile"
          : "stack" in edit.at
            ? ` in ${view(edit.at.stack)}`
            : ` ${SIDE_WORDS[edit.at.side ?? "right"]} ${view(edit.at.beside)}`;
      return `Add ${componentTitle(edit.type)}${at}${edit.layout ? ` to ${layout(edit.layout)}` : ""}`;
    }
    case "set_props":
      return `Change ${view(edit.id)} settings: ${Object.keys(edit.props).join(", ")}`;
    case "remove":
      return `Remove ${view(edit.id)}`;
    case "split":
      return `Add an empty tile ${SIDE_WORDS[edit.side ?? "right"]} ${view(edit.id)}`;
    case "swap":
      return `Swap ${view(edit.a)} and ${view(edit.b)}`;
    case "bind":
      return `Link ${view(edit.id)} to ${COORDINATION_TYPES[edit.type].label} link ${edit.scope}`;
    case "unbind":
      return `Unlink ${view(edit.id)} from its ${COORDINATION_TYPES[edit.type].label} link`;
    case "set_filter":
      return `${edit.clause === null ? "Clear" : "Filter"} ${edit.facet} on filter link ${edit.scope}`;
    case "add_tab":
      return `Add ${componentTitle(edit.type)} as a tab of ${view(edit.tile)}`;
    case "move_tab":
      return `Move ${view(edit.id)} to ${view(edit.to)}`;
    case "close_tab":
      return `Close ${view(edit.id)}`;
    case "set_active_tab":
      return `Show ${view(edit.id)} in its tile`;
    case "add_layout":
      return `Add layout "${edit.name}"${edit.from ? ` copied from ${layout(edit.from)}` : ""}`;
    case "rename_layout":
      return `Rename ${layout(edit.id)} to "${edit.name}"`;
    case "remove_layout":
      return `Remove ${layout(edit.id)}`;
    case "set_active_layout":
      return `Show ${layout(edit.id)}`;
  }
}
