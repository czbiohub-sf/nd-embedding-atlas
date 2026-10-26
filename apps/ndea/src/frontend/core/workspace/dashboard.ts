/**
 * The dashboard: named layouts, each a flat spec `{ root, elements }`
 * that composes the whole workspace UI. Every element is one component: layout
 * (`split`, `stack`), a tile's `tabs`, an empty `slot`, or a view (`scatter`,
 * `table`, `text`, `select`, …) whose props are its configuration. Element ids
 * are unique across every layout of the workspace.
 *
 * Props every data component shares:
 * - `data`: the named data source it reads (see `data-sources.ts`); omitted
 *   means every observation.
 * - `title`: its header text.
 * - `<coordination type>`: `{ $bindState: "/<type>/<scope>" }` joins a
 *   coordination scope (two-way: the view reads and writes `state` there).
 *
 * Pure (Zod + definitions' config contracts) so the server validates and
 * evaluates exactly what the browser renders.
 */

import type { JsonValue } from "@ndea/sdk";
import { createComponentCatalog, type ComponentServices } from "@ndea/components/catalog";
import { z } from "zod";

import {
  bindingScope,
  COORDINATION_TYPE_IDS,
  type CoordinationBinding,
  type CoordinationTypeId,
} from "../coordination/types";
import type { DataSources } from "./data-sources";

export type SplitSide = "left" | "right" | "up" | "down";

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

const ELEMENT_ID = /^[A-Za-z0-9_-]{1,64}$/;

const elementSchema = z
  .object({
    type: z.string().min(1),
    props: z.record(z.string(), jsonValueSchema),
    children: z.array(z.string()),
  })
  .strict();

export const dashboardSchema = z
  .object({
    root: z.string().min(1),
    elements: z.record(z.string().regex(ELEMENT_ID, "element ids use letters, digits, _ and -"), elementSchema),
  })
  .strict();

export type DashboardElement = z.infer<typeof elementSchema>;
export type Dashboard = z.infer<typeof dashboardSchema>;

export const layoutsSchema = z.record(
  z.string().regex(ELEMENT_ID, "layout ids use letters, digits, _ and -"),
  z.object({ name: z.string().trim().min(1).max(64), spec: dashboardSchema }).strict(),
);
export type Layouts = z.infer<typeof layoutsSchema>;

/** The document fields layouts live in: every layout and the active one's id. */
export interface LayoutDocument {
  readonly layouts: Layouts;
  readonly layout: string;
}

/** A literal string, or an expression (`coordination/expressions.ts`) over coordination state: what a `title` takes. */
const textSchema = z.union([
  z.string(),
  z.object({ $template: z.string() }).strict(),
  z.object({ $state: z.string() }).strict(),
]);

export type ComponentChildren = "two" | "any" | "none";

export interface ComponentInfo {
  /** Sentence-case display name (tile tab, empty-tile picker). */
  readonly title: string;
  readonly description: string;
  /** The component's own props, after defaults; common props are checked separately. */
  readonly props: z.ZodType;
  readonly defaults: Record<string, JsonValue>;
  readonly children: ComponentChildren;
  /** Whether it reads a data source (`data`) and has a `title`. */
  readonly reads: boolean;
  /** Coordination types it may bind. */
  readonly binds: readonly CoordinationTypeId[];
  /** Backed by a view body (a component definition), mounted through the runtime manager. */
  readonly view: boolean;
}

/** The layout components; everything else is a view definition. */
const LAYOUT_COMPONENTS: Record<string, ComponentInfo> = {
  split: {
    title: "Split",
    description: "Two children side by side (row) or stacked (column); ratio is the first child's share.",
    props: z.object({ direction: z.enum(["row", "column"]), ratio: z.number().min(0.05).max(0.95) }).strict(),
    defaults: { direction: "row", ratio: 0.5 },
    children: "two",
    reads: false,
    binds: [],
    view: false,
  },
  stack: {
    title: "Stack",
    description: "Any number of children in a row or column, sharing the space equally.",
    props: z.object({ direction: z.enum(["row", "column"]), gap: z.number().min(0).max(64) }).strict(),
    defaults: { direction: "column", gap: 4 },
    children: "any",
    reads: false,
    binds: [],
    view: false,
  },
  tabs: {
    title: "Tabs",
    description: "A tile holding several views as tabs; `active` is the id of the child it shows.",
    props: z.object({ active: z.string().min(1) }).strict(),
    defaults: {},
    children: "any",
    reads: false,
    binds: [],
    view: false,
  },
  slot: {
    title: "Empty tile",
    description: "An empty tile the user fills with a component.",
    props: z.object({}).strict(),
    defaults: {},
    children: "none",
    reads: false,
    binds: [],
    view: false,
  },
};

function noBodiesHere(): never {
  throw new Error("view bodies mount only in the browser runtime");
}

/**
 * Every view definition as a component, keyed by its type. Bodies and
 * their services belong to the browser; only contracts are read here.
 */
function viewComponents(): Record<string, ComponentInfo> {
  const catalog = createComponentCatalog({ mountBody: noBodiesHere, services: {} as ComponentServices });
  const out: Record<string, ComponentInfo> = {};
  for (const definition of Object.values(catalog)) {
    const config = definition.config;
    out[definition.type] = {
      title: definition.title,
      description: definition.documentation.summary,
      props: config?.schema ?? z.object({}).strict(),
      defaults: (config?.defaultValue ?? {}) as Record<string, JsonValue>,
      children: "none",
      reads: true,
      binds: definition.binds,
      view: true,
    };
  }
  return out;
}

/** The component catalog. Definitions are static, so one table serves every caller. */
export const COMPONENTS: Readonly<Record<string, ComponentInfo>> = Object.freeze({
  ...LAYOUT_COMPONENTS,
  ...viewComponents(),
});

/**
 * Views an empty tile can take as-is: valid at their defaults (`text` needs
 * text, `select` a column; agents add those with props).
 */
export const EMPTY_TILE_CHOICES: readonly string[] = Object.entries(COMPONENTS)
  .filter(([, info]) => info.view && info.props.safeParse(info.defaults).success)
  .map(([type]) => type);

const COMMON_PROPS = new Set<string>(["data", "title", ...COORDINATION_TYPE_IDS]);

/** The element's own props merged over its component defaults; common props removed. */
export function componentProps(element: DashboardElement): Record<string, JsonValue> {
  const own: Record<string, JsonValue> = { ...COMPONENTS[element.type]?.defaults };
  for (const [key, value] of Object.entries(element.props)) if (!COMMON_PROPS.has(key)) own[key] = value;
  return own;
}

/** The scope an element binds for one coordination type, or undefined. */
export function elementScope(element: DashboardElement | undefined, type: CoordinationTypeId): string | undefined {
  const binding = element?.props[type];
  if (!binding || typeof binding !== "object" || Array.isArray(binding)) return undefined;
  return bindingScope(type, binding as unknown as CoordinationBinding);
}

export function elementData(element: DashboardElement | undefined): string | undefined {
  const data = element?.props.data;
  return typeof data === "string" ? data : undefined;
}

/** The element's own `title` when set and not empty, else its component's title: tab strips, links, summaries. */
export function elementTitle(element: DashboardElement): string {
  const { title } = element.props;
  return typeof title === "string" && title ? title : (COMPONENTS[element.type]?.title ?? element.type);
}

/** Every rule the element schema cannot express for one layout's spec at `base`, as `[path, message]` pairs. */
export function dashboardIssues(dashboard: Dashboard, data: DataSources, base: string[]): [string[], string][] {
  const at = (id: string, ...rest: string[]) => [...base, "elements", id, ...rest];
  const issues: [string[], string][] = [];
  if (!dashboard.elements[dashboard.root]) return [[[...base, "root"], `unknown element "${dashboard.root}"`]];
  const seen = new Set<string>();
  const visit = (id: string, path: string[]) => {
    const element = dashboard.elements[id];
    if (!element) return issues.push([path, `unknown element "${id}"`]);
    if (seen.has(id)) return issues.push([path, `element "${id}" appears twice`]);
    seen.add(id);
    element.children.forEach((child, index) => visit(child, at(id, "children", String(index))));
  };
  visit(dashboard.root, [...base, "root"]);

  for (const [id, element] of Object.entries(dashboard.elements)) {
    if (!seen.has(id)) issues.push([at(id), "unreachable from root"]);
    const info = COMPONENTS[element.type];
    if (!info) {
      issues.push([
        at(id, "type"),
        `unknown component "${element.type}"; known: ${Object.keys(COMPONENTS).join(", ")}`,
      ]);
      continue;
    }
    const count = element.children.length;
    if (info.children === "two" && count !== 2) issues.push([at(id, "children"), `${element.type} takes 2 children`]);
    if (info.children === "none" && count !== 0) issues.push([at(id, "children"), `${element.type} takes no children`]);
    if (element.type === "tabs") {
      if (count === 0) issues.push([at(id, "children"), "tabs takes at least one child"]);
      element.children.forEach((child, index) => {
        const type = dashboard.elements[child]?.type;
        if (type !== undefined && !COMPONENTS[type]?.view) {
          issues.push([at(id, "children", String(index)), `tabs hold views; "${child}" is a ${type}`]);
        }
      });
      const active = element.props.active;
      if (typeof active === "string" && !element.children.includes(active)) {
        issues.push([at(id, "props", "active"), `"${active}" is not one of its tabs`]);
      }
    }

    const parsed = info.props.safeParse(componentProps(element));
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        issues.push([at(id, "props", ...issue.path.map(String)), issue.message]);
      }
    }
    for (const key of ["data", "title"]) {
      if (key in element.props && !info.reads) issues.push([at(id, "props", key), `${element.type} has no ${key}`]);
    }
    const name = element.props.data;
    if (name !== undefined && info.reads) {
      if (typeof name !== "string") issues.push([at(id, "props", "data"), "must name a data source"]);
      else if (!data[name]) issues.push([at(id, "props", "data"), `unknown data source "${name}"`]);
    }
    if (element.props.title !== undefined && info.reads && textSchema.safeParse(element.props.title).error) {
      issues.push([at(id, "props", "title"), "must be a string or {$template}"]);
    }
    for (const type of COORDINATION_TYPE_IDS) {
      if (!(type in element.props)) continue;
      if (!info.binds.includes(type)) issues.push([at(id, "props", type), `${element.type} cannot bind ${type}`]);
      else if (elementScope(element, type) === undefined) {
        issues.push([at(id, "props", type), `must be { "$bindState": "/${type}/<scope>" }`]);
      }
    }
  }
  return issues;
}

/** Missing or unknown active layout, every layout's spec, and element ids used by two layouts. */
export function layoutIssues(doc: LayoutDocument, data: DataSources): [string[], string][] {
  const issues: [string[], string][] = [];
  if (Object.keys(doc.layouts).length === 0) issues.push([["layouts"], "a workspace has at least one layout"]);
  else if (!Object.hasOwn(doc.layouts, doc.layout)) issues.push([["layout"], `unknown layout "${doc.layout}"`]);
  const owner = new Map<string, string>();
  for (const [layout, { spec }] of Object.entries(doc.layouts)) {
    issues.push(...dashboardIssues(spec, data, ["layouts", layout, "spec"]));
    for (const id of Object.keys(spec.elements)) {
      const first = owner.get(id);
      if (first === undefined) owner.set(id, layout);
      else {
        issues.push([
          ["layouts", layout, "spec", "elements", id],
          `element id "${id}" is also in layout "${first}"; ids are unique across layouts`,
        ]);
      }
    }
  }
  return issues;
}

/* ── layout lookups ────────────────────────────────────────────────── */

/** The active layout's spec. */
export function activeSpec(doc: LayoutDocument): Dashboard {
  return doc.layouts[doc.layout].spec;
}

/** The id of the layout holding element `id`. */
export function layoutOf(doc: LayoutDocument, id: string): string | undefined {
  return Object.keys(doc.layouts).find((layout) => Object.hasOwn(doc.layouts[layout].spec.elements, id));
}

/** An element of any layout. */
export function findElement(doc: LayoutDocument, id: string): DashboardElement | undefined {
  const layout = layoutOf(doc, id);
  return layout === undefined ? undefined : doc.layouts[layout].spec.elements[id];
}

/** Every element of every layout. */
export function allElements(doc: LayoutDocument): [string, DashboardElement][] {
  return Object.values(doc.layouts).flatMap(({ spec }) => Object.entries(spec.elements));
}

/** Every element id in the workspace: what a fresh id must avoid. */
export function takenIds(doc: LayoutDocument): Set<string> {
  return new Set(allElements(doc).map(([id]) => id));
}

/** The view a tile shows: a `tabs` tile's active tab, or a view leaf itself. */
export function tileView(spec: Dashboard, tile: string): string | undefined {
  const element = spec.elements[tile];
  if (element?.type === "tabs") return element.props.active as string;
  return element && COMPONENTS[element.type]?.view ? tile : undefined;
}

/* ── operations: pure edits the dashboard UI and agents share ──────────── */

const NO_IDS: ReadonlySet<string> = new Set();
const SLOT: DashboardElement = { type: "slot", props: {}, children: [] };

/** `<prefix>-<n>`, not in `taken`: a fresh element or layout id. */
export function freshId(prefix: string, taken: { has(id: string): boolean }): string {
  for (let n = 1; ; n += 1) {
    const id = `${prefix}-${n}`;
    if (!taken.has(id)) return id;
  }
}

/** A fresh element id: free in `dashboard` and in `reserved` (the other layouts' ids). */
export function freshElementId(dashboard: Dashboard, prefix: string, reserved: ReadonlySet<string> = NO_IDS): string {
  return freshId(prefix, { has: (id) => Object.hasOwn(dashboard.elements, id) || reserved.has(id) });
}

export function parentOf(dashboard: Dashboard, id: string): string | undefined {
  return Object.keys(dashboard.elements).find((key) => dashboard.elements[key].children.includes(id));
}

/** Point whatever referenced `from` (a parent's child slot, or the root) at `to`. */
function relink(dashboard: Dashboard, from: string, to: string): Dashboard {
  if (dashboard.root === from) return { ...dashboard, root: to };
  const parent = parentOf(dashboard, from);
  if (parent === undefined) return dashboard;
  const element = dashboard.elements[parent];
  const children = element.children.map((child) => (child === from ? to : child));
  return { ...dashboard, elements: { ...dashboard.elements, [parent]: { ...element, children } } };
}

function withoutElements(dashboard: Dashboard, ids: readonly string[]): Dashboard {
  const elements = { ...dashboard.elements };
  for (const id of ids) delete elements[id];
  return { ...dashboard, elements };
}

function subtree(dashboard: Dashboard, id: string): string[] {
  const element = dashboard.elements[id];
  return element ? [id, ...element.children.flatMap((child) => subtree(dashboard, child))] : [];
}

/**
 * Remove an element and its subtree. A `split` parent collapses into the
 * sibling; a tab leaves its `tabs` (see `closeTab`); a removed root leaves an
 * empty slot.
 */
export function removeElement(dashboard: Dashboard, id: string, reserved: ReadonlySet<string> = NO_IDS): Dashboard {
  if (!dashboard.elements[id]) return dashboard;
  const removed = subtree(dashboard, id);
  if (dashboard.root === id) {
    const slot = freshElementId(withoutElements(dashboard, removed), "slot", reserved);
    return { root: slot, elements: { ...withoutElements(dashboard, removed).elements, [slot]: SLOT } };
  }
  const parent = parentOf(dashboard, id)!;
  const parentElement = dashboard.elements[parent];
  if (parentElement.type === "tabs") return withoutElements(vacate(dashboard, id, reserved), removed);
  if (parentElement.type === "split") {
    const sibling = parentElement.children.find((child) => child !== id)!;
    return withoutElements(relink(dashboard, parent, sibling), [parent, ...removed]);
  }
  const next = withoutElements(dashboard, removed);
  return {
    ...next,
    elements: {
      ...next.elements,
      [parent]: { ...parentElement, children: parentElement.children.filter((child) => child !== id) },
    },
  };
}

/** Split an element; the new empty slot (`slot`, default a fresh id) sits on `side`. Returns the dashboard and the slot id. */
export function splitElement(
  dashboard: Dashboard,
  id: string,
  side: SplitSide,
  reserved: ReadonlySet<string> = NO_IDS,
  slot: string = freshElementId(dashboard, "slot", reserved),
): [Dashboard, string | null] {
  if (!dashboard.elements[id]) return [dashboard, null];
  const split = freshElementId(dashboard, "split", reserved);
  const direction = side === "left" || side === "right" ? "row" : "column";
  const children = side === "left" || side === "up" ? [slot, id] : [id, slot];
  const linked = relink(dashboard, id, split);
  return [
    {
      ...linked,
      elements: {
        ...linked.elements,
        [slot]: SLOT,
        [split]: { type: "split", props: { direction, ratio: 0.5 }, children },
      },
    },
    slot,
  ];
}

/** Props a view starts with in a tile: bound to filter A and focus A when it can bind them. */
export function tileProps(type: string): Record<string, JsonValue> {
  const props: Record<string, JsonValue> = {};
  if (COMPONENTS[type]?.binds.includes("filter")) props.filter = { $bindState: "/filter/A" };
  if (COMPONENTS[type]?.binds.includes("focus")) props.focus = { $bindState: "/focus/A" };
  return props;
}

/** Exchange two elements' places in the tree. */
export function swapElements(dashboard: Dashboard, a: string, b: string): Dashboard {
  if (a === b || !dashboard.elements[a] || !dashboard.elements[b]) return dashboard;
  if (subtree(dashboard, a).includes(b) || subtree(dashboard, b).includes(a)) return dashboard;
  const swap = (child: string) => (child === a ? b : child === b ? a : child);
  const elements: Dashboard["elements"] = {};
  for (const [id, element] of Object.entries(dashboard.elements)) {
    elements[id] = { ...element, children: element.children.map(swap) };
  }
  return { root: swap(dashboard.root), elements };
}

export function setElementProps(dashboard: Dashboard, id: string, patch: Record<string, JsonValue | undefined>) {
  const element = dashboard.elements[id];
  if (!element) return dashboard;
  const props = { ...element.props };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) delete props[key];
    else props[key] = value;
  }
  return { ...dashboard, elements: { ...dashboard.elements, [id]: { ...element, props } } };
}

/**
 * Take a view out of its tile; its element stays in `elements`, detached. A
 * tab leaves its `tabs` (the neighbour becomes active); the last tab, or a
 * bare view leaf, leaves an empty tile.
 */
function vacate(dashboard: Dashboard, id: string, reserved: ReadonlySet<string>): Dashboard {
  const parent = parentOf(dashboard, id);
  const tabs = parent === undefined ? undefined : dashboard.elements[parent];
  if (parent !== undefined && tabs?.type === "tabs" && tabs.children.length > 1) {
    const index = tabs.children.indexOf(id);
    const children = tabs.children.toSpliced(index, 1);
    const active = tabs.props.active === id ? children[Math.max(0, index - 1)] : tabs.props.active;
    return {
      ...dashboard,
      elements: { ...dashboard.elements, [parent]: { ...tabs, props: { ...tabs.props, active }, children } },
    };
  }
  const place = tabs?.type === "tabs" ? parent! : id;
  const slot = freshElementId(dashboard, "slot", reserved);
  const linked = relink(dashboard, place, slot);
  const elements = { ...linked.elements, [slot]: SLOT };
  if (place !== id) delete elements[place];
  return { ...linked, elements };
}

/** Close a tab (or a bare view leaf): its element goes; the last tab leaves an empty tile. */
export function closeTab(dashboard: Dashboard, id: string, reserved: ReadonlySet<string> = NO_IDS): Dashboard {
  if (!dashboard.elements[id]) return dashboard;
  return withoutElements(vacate(dashboard, id, reserved), [id]);
}

/**
 * Put the detached view `id` (already in `elements`) into tile `to` at `index`
 * and make it active: a `tabs` tile takes it as a tab, a bare view leaf is
 * wrapped in a new `tabs`, and an empty slot is replaced by it.
 */
export function insertTab(
  dashboard: Dashboard,
  id: string,
  to: string,
  index: number | undefined,
  reserved: ReadonlySet<string> = NO_IDS,
): Dashboard {
  const target = dashboard.elements[to];
  if (!target) return dashboard;
  if (target.type === "slot") {
    return withoutElements(relink(dashboard, to, id), [to]);
  }
  if (target.type === "tabs") {
    const children = target.children.toSpliced(index ?? target.children.length, 0, id);
    return {
      ...dashboard,
      elements: { ...dashboard.elements, [to]: { ...target, props: { ...target.props, active: id }, children } },
    };
  }
  const tabs = freshElementId(dashboard, "tabs", reserved);
  const linked = relink(dashboard, to, tabs);
  const children = [to].toSpliced(index ?? 1, 0, id);
  return { ...linked, elements: { ...linked.elements, [tabs]: { type: "tabs", props: { active: id }, children } } };
}

/** Move view `id` into tile `to` (see `insertTab`); within its own `tabs` it reorders. Same layout only. */
export function moveTab(
  dashboard: Dashboard,
  id: string,
  to: string,
  index: number | undefined,
  reserved: ReadonlySet<string> = NO_IDS,
): Dashboard {
  const parent = parentOf(dashboard, id);
  if (parent === to) {
    const tabs = dashboard.elements[to];
    const rest = tabs.children.filter((child) => child !== id);
    const children = rest.toSpliced(index ?? rest.length, 0, id);
    return { ...dashboard, elements: { ...dashboard.elements, [to]: { ...tabs, props: { active: id }, children } } };
  }
  return insertTab(vacate(dashboard, id, reserved), id, to, index, reserved);
}

/** A one-slot dashboard: the base an agent or user builds from. */
export function emptyDashboard(slot = "slot-1"): Dashboard {
  return { root: slot, elements: { [slot]: SLOT } };
}

/**
 * A copy of `spec` with every element renamed `<type>-<n>`, free of
 * `reserved`: a duplicated layout never shares an id with its source.
 */
export function renameElements(spec: Dashboard, reserved: ReadonlySet<string>): Dashboard {
  const taken = new Set(reserved);
  const names = new Map<string, string>();
  for (const [id, element] of Object.entries(spec.elements)) {
    const name = freshId(element.type, taken);
    taken.add(name);
    names.set(id, name);
  }
  const rename = (id: string) => names.get(id) ?? id;
  const elements: Dashboard["elements"] = {};
  for (const [id, element] of Object.entries(spec.elements)) {
    const props =
      element.type === "tabs" ? { ...element.props, active: rename(element.props.active as string) } : element.props;
    elements[rename(id)] = { ...element, props, children: element.children.map(rename) };
  }
  return { root: rename(spec.root), elements };
}
