import { expect, test } from "bun:test";

import { EMPTY_TILE_CHOICES, activeSpec } from "@/core/workspace/dashboard";
import { emptyWorkspaceDocument } from "@/core/workspace/document";
import { applyDashboardEdits } from "@/core/workspace/edits";
import { datasetFilterEdit } from "./collections";
import { addCommands, collectionsGroup, layoutsGroup, shellCommands, tileCommands, type CommandItem } from "./commands";

const doc = applyDashboardEdits(emptyWorkspaceDocument(), [
  { op: "add", type: "count", id: "count" },
  { op: "split", id: "count", side: "right", slot: "empty" },
  { op: "add_layout", id: "other", name: "Other" },
]);
const spec = activeSpec(doc);
const ids = (items: CommandItem[]) => items.map((item) => item.id);

test("layouts: one row per layout, the active one current, each switching to it", () => {
  const { items } = layoutsGroup(doc);
  expect(items.map(({ id, label, current, action }) => ({ id, label, current, action }))).toEqual([
    {
      id: "layout:main",
      label: "Main",
      current: true,
      action: { kind: "edits", edits: [{ op: "set_active_layout", id: "main" }] },
    },
    {
      id: "layout:other",
      label: "Other",
      current: false,
      action: { kind: "edits", edits: [{ op: "set_active_layout", id: "other" }] },
    },
  ]);
});

test("tile commands follow the selection: view commands only for a view, split and remove for any tile", () => {
  expect(tileCommands(spec, null)).toEqual([]);
  expect(tileCommands(spec, "gone")).toEqual([]);
  const view = tileCommands(spec, "count");
  expect(ids(view)).toEqual([
    "view:fullscreen",
    "view:reference",
    "tile:split-left",
    "tile:split-right",
    "tile:split-up",
    "tile:split-down",
    "tile:remove",
  ]);
  expect(view[0].action).toEqual({ kind: "fullscreen", view: "count" });
  expect(view.at(-1)?.action).toEqual({ kind: "edits", edits: [{ op: "remove", id: "count" }] });
  expect(ids(tileCommands(spec, "empty"))).not.toContain("view:fullscreen");
});

test("add commands fill the first empty tile, and need one", () => {
  const adds = addCommands(spec);
  expect(adds).toHaveLength(EMPTY_TILE_CHOICES.length);
  expect(adds[0].action).toMatchObject({
    kind: "edits",
    edits: [{ op: "add", type: EMPTY_TILE_CHOICES[0], at: { slot: "empty" } }],
  });
  expect(addCommands(activeSpec(applyDashboardEdits(doc, [{ op: "remove", id: "empty" }])))).toEqual([]);
});

test("shell commands: toggle sidebar, then open each panel", () => {
  const panels = { layouts: { title: "Layouts", icon: null } } as Parameters<typeof shellCommands>[0];
  expect(shellCommands(panels).map((item) => item.action)).toEqual([
    { kind: "sidebar" },
    { kind: "panel", panel: "layouts" },
  ]);
});

test("collections: the open one's datasets filter, another collection switches", () => {
  const open = {
    name: "a",
    datasets: [
      { name: "a1", nObs: 2 },
      { name: "a2", nObs: 3 },
    ],
  };
  const other = { name: "b", datasets: [{ name: "b1", nObs: 1 }] };
  expect(collectionsGroup({ collections: [other], open: undefined, included: null })).toBeNull();
  const group = collectionsGroup({ collections: [open, other], open, included: new Set(["a1"]) });
  const [a, b] = group?.items ?? [];
  expect(a.sub).toBe("2 datasets · 5 obs");
  expect(a.action).toEqual({ kind: "edits", edits: [datasetFilterEdit(["a1", "a2"], null)] });
  expect(a.children?.map((d) => [d.current, d.action])).toEqual([
    [true, { kind: "edits", edits: [datasetFilterEdit(["a1", "a2"], ["a1"])] }],
    [false, { kind: "edits", edits: [datasetFilterEdit(["a1", "a2"], ["a2"])] }],
  ]);
  expect(b.action).toEqual({ kind: "switch-collection", name: "b" });
  expect(b.children?.[0].action).toEqual({ kind: "switch-collection", name: "b" });
});

test("the dataset filter: one dataset eq, several in, every one cleared", () => {
  const names = ["a", "b", "c"];
  expect(datasetFilterEdit(names, ["a"])).toMatchObject({ clause: { op: "eq", column: "_dataset", value: "a" } });
  expect(datasetFilterEdit(names, ["a", "b"])).toMatchObject({ clause: { op: "in", values: ["a", "b"] } });
  expect(datasetFilterEdit(names, names)).toMatchObject({ clause: null });
  expect(datasetFilterEdit(names, null)).toMatchObject({ clause: null });
});
