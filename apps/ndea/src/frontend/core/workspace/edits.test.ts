import { describe, expect, test } from "bun:test";

import { emptyWorkspaceDocument, parseWorkspaceDocument } from "./document.ts";
import {
  applyDashboardEdits,
  describeEdit,
  elementReference,
  resolveEditReferences,
  resolveElementId,
  WorkspaceEditError,
  type DashboardEdit,
} from "./edits.ts";

const filterA = { $bindState: "/filter/A" };
const large = { op: "gt", column: "area", value: 40 } as const;

const BUILD: DashboardEdit[] = [
  { op: "set_data", name: "infected", source: { where: { op: "eq", column: "condition", value: "infected" } } },
  { op: "add", type: "count", props: { data: "infected" } },
  { op: "add", type: "table", at: { beside: "count-1", side: "down" } },
  { op: "add", type: "stack", id: "tools", at: { beside: "count-1", side: "left" } },
  { op: "add", type: "text", props: { text: "Cells" }, at: { stack: "tools" } },
  { op: "add", type: "select", props: { column: "condition" }, at: { stack: "tools", index: 0 } },
  { op: "bind", id: "select-1", type: "filter", scope: "A" },
  { op: "bind", id: "count-1", type: "filter", scope: "A" },
  { op: "set_filter", scope: "A", source: "agent", facet: "area", clause: large },
];

describe("dashboard edits", () => {
  test("add fills an empty root, splits beside, inserts into stacks; bind seeds the scope", () => {
    const next = applyDashboardEdits(emptyWorkspaceDocument(), BUILD);
    expect(next).toEqual({
      data: { infected: { where: { op: "eq", column: "condition", value: "infected" } } },
      layouts: {
        main: {
          name: "Main",
          spec: {
            root: "split-1",
            elements: {
              "split-1": {
                type: "split",
                props: { direction: "column", ratio: 0.5 },
                children: ["split-2", "table-1"],
              },
              "split-2": { type: "split", props: { direction: "row", ratio: 0.5 }, children: ["tools", "count-1"] },
              "count-1": { type: "count", props: { data: "infected", filter: filterA }, children: [] },
              "table-1": { type: "table", props: {}, children: [] },
              tools: { type: "stack", props: {}, children: ["select-1", "text-1"] },
              "text-1": { type: "text", props: { text: "Cells" }, children: [] },
              "select-1": { type: "select", props: { column: "condition", filter: filterA }, children: [] },
            },
          },
        },
      },
      layout: "main",
      state: { filter: { A: { agent: { area: large } } } },
    });
    expect(parseWorkspaceDocument(next).ok).toBe(true);
  });

  test("unbind and remove drop the element's own clauses; swap and set_props rearrange and merge", () => {
    const built = applyDashboardEdits(emptyWorkspaceDocument(), [
      ...BUILD,
      {
        op: "set_filter",
        scope: "A",
        source: "select-1",
        facet: "condition",
        clause: { op: "in", column: "condition", values: ["mock"] },
      },
      { op: "set_filter", scope: "A", source: "count-1", facet: "x", clause: large },
    ]);
    const swapped = applyDashboardEdits(built, [
      { op: "unbind", id: "select-1", type: "filter" },
      { op: "remove", id: "table-1" },
      { op: "swap", a: "tools", b: "count-1" },
    ]);
    const spec = swapped.layouts.main.spec;
    expect(spec.root).toBe("split-2");
    expect(spec.elements["split-2"].children).toEqual(["count-1", "tools"]);
    expect(spec.elements["select-1"].props).toEqual({ column: "condition" });
    expect(Object.keys(swapped.state.filter?.A ?? {}).toSorted()).toEqual(["agent", "count-1"]);

    const next = applyDashboardEdits(swapped, [
      { op: "remove", id: "count-1" },
      { op: "remove", id: "text-1" },
      { op: "set_props", id: "tools", props: { gap: 4, direction: null } },
      { op: "set_filter", scope: "A", source: "agent", facet: "area", clause: null },
    ]);
    expect(next.layouts.main.spec).toEqual({
      root: "tools",
      elements: {
        tools: { type: "stack", props: { gap: 4 }, children: ["select-1"] },
        "select-1": { type: "select", props: { column: "condition" }, children: [] },
      },
    });
    expect(next.state).toEqual({ filter: { A: {} } });
    expect(parseWorkspaceDocument(next).ok).toBe(true);
  });

  test("an op that cannot apply names its index and leaves the base untouched", () => {
    const base = emptyWorkspaceDocument();
    const cases: [DashboardEdit[], number, string][] = [
      [[BUILD[0], { op: "add", type: "count", at: { slot: "ghost" } }], 1, 'no element "ghost"'],
      [[{ op: "add", type: "nope" }], 0, 'unknown component "nope"'],
      [[BUILD[1], { op: "add", type: "text", at: { stack: "count-1" } }], 1, "not a stack"],
      [[BUILD[1], { op: "add", type: "count", id: "count-1" }], 1, "is taken"],
      [[{ op: "unbind", id: "slot-1", type: "filter" }], 0, "not bound"],
      [[{ op: "remove_data", name: "infected" }], 0, 'no data source "infected"'],
      [[BUILD[1], BUILD[2], { op: "swap", a: "split-1", b: "count-1" }], 2, "cannot swap"],
      [[BUILD[1], { op: "add_tab", tile: "count-1", type: "stack" }], 1, "not a view"],
      [[BUILD[1], { op: "split", id: "count-1", slot: "count-1" }], 1, "is taken"],
      [[BUILD[1], { op: "set_active_tab", tile: "count-1", id: "slot-1" }], 1, "not a tab"],
      [
        [
          BUILD[1],
          { op: "add_layout", name: "B" },
          { op: "add", type: "table", layout: "layout-1" },
          { op: "move_tab", id: "table-1", to: "count-1" },
        ],
        3,
        "different layouts",
      ],
      [[{ op: "remove_layout", id: "main" }], 0, "the only layout"],
      [[{ op: "set_active_layout", id: "nope" }], 0, 'no layout "nope"'],
    ];
    for (const [edits, index, message] of cases) {
      let error: unknown;
      try {
        applyDashboardEdits(base, edits);
      } catch (caught) {
        error = caught;
      }
      if (!(error instanceof WorkspaceEditError))
        throw new Error(`expected a WorkspaceEditError, got ${String(error)}`);
      expect({ index: error.index, message: error.message }).toMatchObject({
        index,
        message: expect.stringContaining(message),
      });
    }
    expect(base).toEqual(emptyWorkspaceDocument());
  });
});

describe("tabs and layouts", () => {
  const TWO_VIEWS: DashboardEdit[] = [
    { op: "add", type: "table", id: "table" },
    { op: "add", type: "count", id: "count", at: { beside: "table" } },
  ];

  test("add_tab wraps a bare view; move_tab and close_tab keep every tile valid", () => {
    let doc = applyDashboardEdits(emptyWorkspaceDocument(), [
      ...TWO_VIEWS,
      { op: "add_tab", tile: "table", type: "histogram", id: "hist", props: { filter: filterA } },
    ]);
    const spec = () => doc.layouts.main.spec;
    expect(spec().elements["tabs-1"]).toEqual({ type: "tabs", props: { active: "hist" }, children: ["table", "hist"] });
    expect(doc.state.filter?.A).toEqual({});
    expect(parseWorkspaceDocument(doc).ok).toBe(true);

    doc = applyDashboardEdits(doc, [
      { op: "set_active_tab", tile: "tabs-1", id: "table" },
      { op: "move_tab", id: "hist", to: "count" },
    ]);
    expect(spec().elements["tabs-1"]).toEqual({ type: "tabs", props: { active: "table" }, children: ["table"] });
    expect(spec().elements["tabs-2"]).toEqual({ type: "tabs", props: { active: "hist" }, children: ["count", "hist"] });
    expect(parseWorkspaceDocument(doc).ok).toBe(true);

    doc = applyDashboardEdits(doc, [{ op: "move_tab", id: "hist", to: "count", index: 0 }]);
    expect(spec().elements["tabs-2"].children).toEqual(["hist", "count"]);

    doc = applyDashboardEdits(doc, [{ op: "close_tab", id: "table" }]);
    expect(spec().elements["tabs-1"]).toBeUndefined();
    expect(spec().elements["slot-1"]).toEqual({ type: "slot", props: {}, children: [] });
    expect(parseWorkspaceDocument(doc).ok).toBe(true);

    doc = applyDashboardEdits(doc, [{ op: "remove", id: "hist" }]);
    expect(spec().elements["tabs-2"]).toEqual({ type: "tabs", props: { active: "count" }, children: ["count"] });
    expect(parseWorkspaceDocument(doc).ok).toBe(true);
  });

  test("split leaves an empty tile on its side (a tab splits its tile); set_props sets the ratio", () => {
    let doc = applyDashboardEdits(emptyWorkspaceDocument(), [
      ...TWO_VIEWS,
      { op: "add_tab", tile: "table", type: "histogram", id: "hist" },
      { op: "split", id: "hist", side: "up", slot: "empty" },
      { op: "split", id: "count" },
    ]);
    const { elements } = doc.layouts.main.spec;
    expect(elements["split-2"]).toEqual({
      type: "split",
      props: { direction: "column", ratio: 0.5 },
      children: ["empty", "tabs-1"],
    });
    expect(elements.empty).toEqual({ type: "slot", props: {}, children: [] });
    expect(elements["split-3"]).toEqual({
      type: "split",
      props: { direction: "row", ratio: 0.5 },
      children: ["count", "slot-1"],
    });
    expect(parseWorkspaceDocument(doc).ok).toBe(true);

    doc = applyDashboardEdits(doc, [
      { op: "set_props", id: "split-2", props: { ratio: 0.3 } },
      { op: "add", type: "count", id: "filled", at: { slot: "empty" } },
    ]);
    expect(doc.layouts.main.spec.elements["split-2"]).toEqual({
      type: "split",
      props: { direction: "column", ratio: 0.3 },
      children: ["filled", "tabs-1"],
    });
  });

  test("layouts: a copy gets fresh ids, add targets the active layout, removal falls back", () => {
    let doc = applyDashboardEdits(emptyWorkspaceDocument(), [
      ...TWO_VIEWS,
      { op: "add_layout", id: "copy", name: "Copy", from: "main" },
      { op: "add_layout", name: "Blank" },
      { op: "set_active_layout", id: "copy" },
      { op: "add", type: "count", id: "count-x" },
    ]);
    expect(Object.keys(doc.layouts)).toEqual(["main", "copy", "layout-1"]);
    const ids = Object.values(doc.layouts).flatMap((layout) => Object.keys(layout.spec.elements));
    expect(new Set(ids).size).toBe(ids.length);
    expect(doc.layouts.copy.spec.elements["count-x"]).toBeDefined();
    expect(parseWorkspaceDocument(doc).ok).toBe(true);

    doc = applyDashboardEdits(doc, [
      { op: "rename_layout", id: "copy", name: "Review" },
      { op: "remove_layout", id: "copy" },
    ]);
    expect(doc.layout).toBe("main");
    expect(Object.keys(doc.layouts)).toEqual(["main", "layout-1"]);
  });

  test("an element id in two layouts is rejected with a pointer", () => {
    const doc = emptyWorkspaceDocument();
    const parsed = parseWorkspaceDocument({
      ...doc,
      layouts: { ...doc.layouts, other: { name: "Other", spec: doc.layouts.main.spec } },
    });
    expect(parsed.ok ? [] : parsed.issues.map((issue) => issue.pointer)).toEqual([
      "/layouts/other/spec/elements/slot-1",
    ]);
  });
});

describe("element references", () => {
  test("a reference into this workspace resolves; another workspace's is rejected", () => {
    expect(resolveElementId("scatter-1", "atlas")).toBe("scatter-1");
    expect(resolveElementId(elementReference("atlas", "scatter-1"), "atlas")).toBe("scatter-1");
    expect(() => resolveElementId("ndea://other/scatter-1", "atlas")).toThrow(/workspace "other"/);
    const edits: DashboardEdit[] = [
      { op: "swap", a: "ndea://atlas/a", b: "b" },
      { op: "remove", id: "ndea://other/c" },
    ];
    expect(() => resolveEditReferences(edits, "atlas")).toThrow(WorkspaceEditError);
    expect(resolveEditReferences(edits.slice(0, 1), "atlas")).toEqual([{ op: "swap", a: "a", b: "b" }]);
  });
});

test("describeEdit names each change in glossary words against the document it applies to", () => {
  const built = applyDashboardEdits(emptyWorkspaceDocument(), BUILD);
  const say = (edit: DashboardEdit) => describeEdit(edit, built);
  expect(say({ op: "add", type: "histogram", at: { beside: "table-1" } })).toBe("Add Histogram beside Table");
  expect(say({ op: "add", type: "histogram", at: { beside: "count-1", side: "down" } })).toBe(
    "Add Histogram below Count",
  );
  expect(say({ op: "set_data", name: "infected", source: {} })).toBe('Change source "infected"');
  expect(say({ op: "bind", id: "table-1", type: "filter", scope: "A" })).toBe("Link Table to filter link A");
  expect(say({ op: "set_props", id: "count-1", props: { title: "Infected", data: null } })).toBe(
    "Change Count settings: title, data",
  );
  expect(say({ op: "remove", id: "ghost" })).toBe('Remove "ghost"');
  expect(say({ op: "split", id: "table-1", side: "up" })).toBe("Add an empty tile above Table");
  const titled = (title: string) => applyDashboardEdits(built, [{ op: "set_props", id: "count-1", props: { title } }]);
  expect(describeEdit({ op: "remove", id: "count-1" }, titled("Cells"))).toBe('Remove "Cells"');
  expect(describeEdit({ op: "remove", id: "count-1" }, titled(""))).toBe("Remove Count");
  expect(say({ op: "add_layout", name: "Review", from: "main" })).toBe('Add layout "Review" copied from layout "Main"');
});
