import { describe, expect, test } from "bun:test";

import { emptyWorkspaceDocument, parseWorkspaceDocument } from "../../frontend/core/workspace/document.ts";
import { applyDashboardEdits, WorkspaceEditError, type DashboardEdit } from "../workspace-edits.ts";

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
      spec: {
        root: "split-1",
        elements: {
          "split-1": { type: "split", props: { direction: "column", ratio: 0.5 }, children: ["split-2", "table-1"] },
          "split-2": { type: "split", props: { direction: "row", ratio: 0.5 }, children: ["tools", "count-1"] },
          "count-1": { type: "count", props: { data: "infected", filter: filterA }, children: [] },
          "table-1": { type: "table", props: {}, children: [] },
          tools: { type: "stack", props: {}, children: ["select-1", "text-1"] },
          "text-1": { type: "text", props: { text: "Cells" }, children: [] },
          "select-1": { type: "select", props: { column: "condition", filter: filterA }, children: [] },
        },
      },
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
    expect(swapped.spec.root).toBe("split-2");
    expect(swapped.spec.elements["split-2"].children).toEqual(["count-1", "tools"]);
    expect(swapped.spec.elements["select-1"].props).toEqual({ column: "condition" });
    expect(Object.keys(swapped.state.filter?.A ?? {}).toSorted()).toEqual(["agent", "count-1"]);

    const next = applyDashboardEdits(swapped, [
      { op: "remove", id: "count-1" },
      { op: "remove", id: "text-1" },
      { op: "set_props", id: "tools", props: { gap: 4, direction: null } },
      { op: "set_filter", scope: "A", source: "agent", facet: "area", clause: null },
    ]);
    expect(next.spec).toEqual({
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
