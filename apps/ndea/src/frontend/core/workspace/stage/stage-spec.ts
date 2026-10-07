/**
 * The Stage as a json-render flat spec: `{ root, elements }`, where each
 * element is a `Split` (two children and a ratio), a `View` of one workspace
 * node, or an empty `Slot`. Pure (Zod + json-render core) so the server
 * validates Stage patches with the browser's rules.
 *
 * A node is on the Stage exactly when a reachable `View` shows it.
 */

import { defineCatalog } from "@json-render/core";
import { schema } from "@json-render/react/schema";
import { z } from "zod";

export type SplitSide = "left" | "right" | "up" | "down";

/** A literal title, or a json-render expression resolved against coordination state. */
const titleSchema = z.union([
  z.string(),
  z.object({ $template: z.string() }).strict(),
  z.object({ $state: z.string() }).strict(),
]);

export const STAGE_COMPONENT_PROPS = {
  Split: z.object({ direction: z.enum(["row", "column"]), ratio: z.number().min(0.05).max(0.95) }).strict(),
  View: z.object({ node: z.string().min(1), title: titleSchema.optional() }).strict(),
  Slot: z.object({}).strict(),
} as const;

const stageElementSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("Split"),
      props: STAGE_COMPONENT_PROPS.Split,
      children: z.tuple([z.string(), z.string()]),
    })
    .strict(),
  z.object({ type: z.literal("View"), props: STAGE_COMPONENT_PROPS.View, children: z.tuple([]) }).strict(),
  z.object({ type: z.literal("Slot"), props: STAGE_COMPONENT_PROPS.Slot, children: z.tuple([]) }).strict(),
]);

export const stageSchema = z
  .object({ root: z.string().min(1), elements: z.record(z.string().min(1), stageElementSchema) })
  .strict()
  .nullable();

export type StageElement = z.infer<typeof stageElementSchema>;
export type Stage = z.infer<typeof stageSchema>;

export const stageCatalog = defineCatalog(schema, {
  components: {
    Split: {
      props: STAGE_COMPONENT_PROPS.Split,
      description: "Two children side by side (row) or stacked (column); ratio is the first child's share.",
    },
    View: {
      props: STAGE_COMPONENT_PROPS.View,
      description: "The live body of one workspace node. Each node appears in at most one View.",
    },
    Slot: { props: STAGE_COMPONENT_PROPS.Slot, description: "An empty tile the user can fill with a node." },
  },
  actions: {},
});

const childrenOf = (element: StageElement): readonly string[] => element.children;

/** Structural rules the element schema cannot express, as `[path, message]` pairs. */
export function stageIssues(stage: Stage, nodeIds: ReadonlySet<string>): [string[], string][] {
  if (!stage) return [];
  const issues: [string[], string][] = [];
  if (!stage.elements[stage.root]) return [[["stage", "root"], `unknown element "${stage.root}"`]];
  const seen = new Set<string>();
  const shown = new Set<string>();
  const visit = (id: string, path: string[]) => {
    const element = stage.elements[id];
    if (!element) return issues.push([path, `unknown element "${id}"`]);
    if (seen.has(id)) return issues.push([path, `element "${id}" appears twice`]);
    seen.add(id);
    if (element.type === "View") {
      const node = element.props.node;
      if (!nodeIds.has(node)) issues.push([["stage", "elements", id, "props", "node"], `unknown node "${node}"`]);
      else if (shown.has(node))
        issues.push([["stage", "elements", id, "props", "node"], `node "${node}" is already shown`]);
      shown.add(node);
    }
    childrenOf(element).forEach((child, index) => visit(child, ["stage", "elements", id, "children", String(index)]));
  };
  visit(stage.root, ["stage", "root"]);
  for (const id of Object.keys(stage.elements)) {
    if (!seen.has(id)) issues.push([["stage", "elements", id], "unreachable from root"]);
  }
  return issues;
}

/** Reachable `View` element ids by node id. */
export function stageViews(stage: Stage): Map<string, string> {
  const views = new Map<string, string>();
  const visit = (id: string) => {
    const element = stage?.elements[id];
    if (!element) return;
    if (element.type === "View") views.set(element.props.node, id);
    childrenOf(element).forEach(visit);
  };
  if (stage) visit(stage.root);
  return views;
}

function freshId(stage: Stage, prefix: string): string {
  for (let n = 1; ; n += 1) {
    const id = `${prefix}-${n}`;
    if (!stage?.elements[id]) return id;
  }
}

function parentOf(stage: NonNullable<Stage>, id: string): string | undefined {
  return Object.keys(stage.elements).find((key) => childrenOf(stage.elements[key]).includes(id));
}

/** Point whatever referenced `from` (a parent's child slot, or the root) at `to`. */
function relink(stage: NonNullable<Stage>, from: string, to: string): NonNullable<Stage> {
  if (stage.root === from) return { ...stage, root: to };
  const parent = parentOf(stage, from)!;
  const element = stage.elements[parent];
  if (element.type !== "Split") return stage;
  const children: [string, string] = [
    element.children[0] === from ? to : element.children[0],
    element.children[1] === from ? to : element.children[1],
  ];
  return { ...stage, elements: { ...stage.elements, [parent]: { ...element, children } } };
}

function withoutElements(stage: NonNullable<Stage>, ids: readonly string[]): NonNullable<Stage> {
  const elements = { ...stage.elements };
  for (const id of ids) delete elements[id];
  return { ...stage, elements };
}

/** Show a node: alone on an empty Stage, else as a new right-hand half of the root. */
export function addView(stage: Stage, node: string): Stage {
  if (stageViews(stage).has(node)) return stage;
  const view = freshId(stage, "view");
  const element: StageElement = { type: "View", props: { node }, children: [] };
  if (!stage) return { root: view, elements: { [view]: element } };
  const split = freshId(stage, "split");
  return {
    root: split,
    elements: {
      ...stage.elements,
      [view]: element,
      [split]: { type: "Split", props: { direction: "row", ratio: 0.5 }, children: [stage.root, view] },
    },
  };
}

/** Remove a leaf; its sibling takes the parent split's place. */
export function removeElement(stage: Stage, id: string): Stage {
  if (!stage?.elements[id]) return stage;
  if (stage.root === id) return null;
  const parent = parentOf(stage, id)!;
  const sibling = childrenOf(stage.elements[parent]).find((child) => child !== id)!;
  return withoutElements(relink(stage, parent, sibling), [parent, id]);
}

export function removeNodeView(stage: Stage, node: string): Stage {
  const view = stageViews(stage).get(node);
  return view === undefined ? stage : removeElement(stage, view);
}

/** Split a leaf; the new empty Slot sits on `side`. Returns the stage and the slot id. */
export function splitElement(stage: Stage, id: string, side: SplitSide): [Stage, string | null] {
  if (!stage?.elements[id]) return [stage, null];
  const slot = freshId(stage, "slot");
  const split = freshId(stage, "split");
  const direction = side === "left" || side === "right" ? "row" : "column";
  const children: [string, string] = side === "left" || side === "up" ? [slot, id] : [id, slot];
  const linked = relink(stage, id, split);
  return [
    {
      ...linked,
      elements: {
        ...linked.elements,
        [slot]: { type: "Slot", props: {}, children: [] },
        [split]: { type: "Split", props: { direction, ratio: 0.5 }, children },
      },
    },
    slot,
  ];
}

/** Put a node into a Slot, moving it there if it is already shown elsewhere. */
export function fillSlot(stage: Stage, slot: string, node: string): Stage {
  if (stage?.elements[slot]?.type !== "Slot") return stage;
  const next = removeNodeView(stage, node);
  if (!next?.elements[slot]) return stage;
  return { ...next, elements: { ...next.elements, [slot]: { type: "View", props: { node }, children: [] } } };
}

/** Exchange two leaves' contents. */
export function swapElements(stage: Stage, a: string, b: string): Stage {
  const left = stage?.elements[a];
  const right = stage?.elements[b];
  if (!stage || !left || !right || left.type === "Split" || right.type === "Split") return stage;
  return { ...stage, elements: { ...stage.elements, [a]: right, [b]: left } };
}

export function setSplitRatio(stage: Stage, id: string, ratio: number): Stage {
  const element = stage?.elements[id];
  if (!stage || element?.type !== "Split") return stage;
  return { ...stage, elements: { ...stage.elements, [id]: { ...element, props: { ...element.props, ratio } } } };
}
