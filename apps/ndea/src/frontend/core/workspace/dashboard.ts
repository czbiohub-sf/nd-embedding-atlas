/**
 * The dashboard: a json-render flat spec `{ root, elements }` that composes the
 * whole workspace UI. Every element is one component: layout (`split`,
 * `stack`), content (`text`), controls (`select`), an empty `slot`, or a view
 * (`scatter`, `table`, `vgplot`, …) whose props are its configuration.
 *
 * Props every data component shares:
 * - `data`: the named data source it reads (see `data-sources.ts`); omitted
 *   means every observation.
 * - `title`: its header text.
 * - `<coordination type>`: `{ $bindState: "/<type>/<scope>" }` joins a
 *   coordination scope (json-render's two-way binding into `state`).
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

/** A literal string, or a json-render expression resolved against coordination state. */
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

const BUILTIN_COMPONENTS: Record<string, ComponentInfo> = {
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
  text: {
    title: "Text",
    description: "A heading or paragraph; `text` may be a {$template} over coordination state.",
    props: z.object({ text: textSchema, variant: z.enum(["heading", "body", "muted"]) }).strict(),
    defaults: { variant: "body" },
    children: "none",
    reads: false,
    binds: [],
    view: false,
  },
  select: {
    title: "Select",
    description:
      "A picker over one column's values (with counts). Choosing values publishes {op:'in'} into its filter scope.",
    props: z.object({ column: z.string().min(1), label: z.string().optional() }).strict(),
    defaults: {},
    children: "none",
    reads: true,
    binds: ["filter"],
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
  ...BUILTIN_COMPONENTS,
  ...viewComponents(),
});

/**
 * Components an empty tile can take as-is: not layout, and valid at their
 * defaults (`text` needs text, `select` a column; agents add those with props).
 */
export const EMPTY_TILE_CHOICES: readonly string[] = Object.entries(COMPONENTS)
  .filter(([type, info]) => !["split", "stack", "slot"].includes(type) && info.props.safeParse(info.defaults).success)
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

const at = (id: string, ...rest: string[]) => ["spec", "elements", id, ...rest];

/** Every rule the element schema cannot express, as `[path, message]` pairs. */
export function dashboardIssues(dashboard: Dashboard, data: DataSources): [string[], string][] {
  const issues: [string[], string][] = [];
  if (!dashboard.elements[dashboard.root]) return [[["spec", "root"], `unknown element "${dashboard.root}"`]];
  const seen = new Set<string>();
  const visit = (id: string, path: string[]) => {
    const element = dashboard.elements[id];
    if (!element) return issues.push([path, `unknown element "${id}"`]);
    if (seen.has(id)) return issues.push([path, `element "${id}" appears twice`]);
    seen.add(id);
    element.children.forEach((child, index) => visit(child, at(id, "children", String(index))));
  };
  visit(dashboard.root, ["spec", "root"]);

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

/* ── operations: pure edits the dashboard UI and agents share ──────────── */

export function freshElementId(dashboard: Dashboard, prefix: string): string {
  for (let n = 1; ; n += 1) {
    const id = `${prefix}-${n}`;
    if (!dashboard.elements[id]) return id;
  }
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
 * sibling; a removed root leaves an empty slot.
 */
export function removeElement(dashboard: Dashboard, id: string): Dashboard {
  if (!dashboard.elements[id]) return dashboard;
  const removed = subtree(dashboard, id);
  if (dashboard.root === id) {
    const slot = freshElementId(withoutElements(dashboard, removed), "slot");
    return {
      root: slot,
      elements: { ...withoutElements(dashboard, removed).elements, [slot]: { type: "slot", props: {}, children: [] } },
    };
  }
  const parent = parentOf(dashboard, id)!;
  const parentElement = dashboard.elements[parent];
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

/** Split an element; the new empty slot sits on `side`. Returns the dashboard and the slot id. */
export function splitElement(dashboard: Dashboard, id: string, side: SplitSide): [Dashboard, string | null] {
  if (!dashboard.elements[id]) return [dashboard, null];
  const slot = freshElementId(dashboard, "slot");
  const split = freshElementId(dashboard, "split");
  const direction = side === "left" || side === "right" ? "row" : "column";
  const children = side === "left" || side === "up" ? [slot, id] : [id, slot];
  const linked = relink(dashboard, id, split);
  return [
    {
      ...linked,
      elements: {
        ...linked.elements,
        [slot]: { type: "slot", props: {}, children: [] },
        [split]: { type: "split", props: { direction, ratio: 0.5 }, children },
      },
    },
    slot,
  ];
}

/** Replace a slot with a new component element (same id). */
export function fillSlot(
  dashboard: Dashboard,
  slot: string,
  type: string,
  props: Record<string, JsonValue>,
): Dashboard {
  if (dashboard.elements[slot]?.type !== "slot") return dashboard;
  return { ...dashboard, elements: { ...dashboard.elements, [slot]: { type, props, children: [] } } };
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

/** A one-slot dashboard: the base an agent or user builds from. */
export function emptyDashboard(): Dashboard {
  return { root: "slot-1", elements: { "slot-1": { type: "slot", props: {}, children: [] } } };
}
