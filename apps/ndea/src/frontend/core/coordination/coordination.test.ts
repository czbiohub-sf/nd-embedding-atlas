import { describe, expect, test } from "bun:test";
import type { FilterClause } from "@ndea/protocol";
import { rowIndex, type RowIndex } from "@ndea/sdk";

import { emptyWorkspaceDocument } from "../workspace/document";
import { applyDashboardEdits } from "../workspace/edits";
import { WorkspaceStore } from "../workspace/workspace-store";
import { createFilterBinding } from "./filter-binding";
import { setFilterFacet } from "./types";

const leaf = { type: "table", props: {}, children: [] };

function fresh() {
  const ws = new WorkspaceStore();
  ws.applyDocument({
    ...emptyWorkspaceDocument(),
    layouts: {
      main: {
        name: "Main",
        spec: {
          root: "root",
          elements: {
            root: { type: "stack", props: {}, children: ["n1", "n2", "n3", "scatter"] },
            n1: leaf,
            n2: leaf,
            n3: leaf,
            scatter: { ...leaf, type: "scatter" },
          },
        },
      },
    },
  });
  return { co: ws.coordination, ws };
}

describe("coordination cells", () => {
  test("bound elements share one cell; scopes are independent", () => {
    const { co } = fresh();
    co.assignScope("n1", "focus", "A");
    co.assignScope("n2", "focus", "A");
    co.assignScope("n3", "focus", "B");
    co.setCoordinationValue("focus", "A", rowIndex(8));
    expect(co.readCoordination("focus", co.scopeOf("n2", "focus")!)).toBe(rowIndex(8));
    expect(co.readCoordination("focus", co.scopeOf("n3", "focus")!)).toBeNull();
  });

  test("binding is a $bindState prop, and the cell is seeded for agent patches", () => {
    const { co, ws } = fresh();
    co.assignScope("n1", "filter", "A");
    expect(ws.element("n1")?.props.filter).toEqual({ $bindState: "/filter/A" });
    expect(co.readCoordination("filter", "A")).toEqual({});
    co.clearScope("n1", "filter");
    expect(ws.element("n1")?.props).toEqual({});
  });

  test("assignScope and clearScope are the bind and unbind edits; rebinding the same scope is a no-op", () => {
    const { co, ws } = fresh();
    ws.coordination.setCoordinationValue("filter", "A", { n1: { lasso: { op: "eq", column: "t", value: 1 } } });
    const before = ws.snapshot();
    co.assignScope("n1", "filter", "A");
    const bound = applyDashboardEdits(before, [{ op: "bind", id: "n1", type: "filter", scope: "A" }]);
    expect(ws.snapshot()).toEqual(bound);
    const after = ws.snapshot();
    co.assignScope("n1", "filter", "A");
    expect(ws.snapshot()).toBe(after);
    co.clearScope("n1", "filter");
    const unbound = ws.snapshot();
    expect(unbound).toEqual(applyDashboardEdits(bound, [{ op: "unbind", id: "n1", type: "filter" }]));
    co.clearScope("n1", "filter");
    co.assignScope("ghost", "filter", "A");
    expect(ws.snapshot()).toBe(unbound);
  });

  test("writes are validated against the type schema", () => {
    const { co } = fresh();
    expect(() => co.setCoordinationValue("focus", "A", -1 as RowIndex)).toThrow("failed validation");
    expect(() => co.setCoordinationValue("ordering", "A", { col: "x", dir: "up" as "asc" })).toThrow(
      "failed validation",
    );
  });

  test("subscribe fires on cell writes and rebinding, never for unrelated scopes", () => {
    const { co } = fresh();
    co.setCoordinationValue("focus", "B", rowIndex(3));
    co.assignScope("n1", "focus", "A");
    const seen: (number | null | undefined)[] = [];
    const off = co.subscribe("n1", "focus", (value) => seen.push(value));
    co.setCoordinationValue("focus", "C", rowIndex(9));
    co.setCoordinationValue("focus", "A", rowIndex(1));
    co.assignScope("n1", "focus", "B");
    co.clearScope("n1", "focus");
    off();
    expect(seen).toEqual([rowIndex(1), rowIndex(3), undefined]);
  });

  test("leaving a filter scope or removing the element drops its crossfilter contribution", () => {
    const { co, ws } = fresh();
    const clause = { op: "eq", column: "t", value: 1 } as const;
    co.assignScope("n1", "filter", "A");
    co.setCoordinationValue("filter", "A", { n1: { lasso: clause }, agent: { where: clause } });
    co.assignScope("n1", "filter", "B");
    expect(co.readCoordination("filter", "A")).toEqual({ agent: { where: clause } });

    co.setCoordinationValue("filter", "B", { n1: { lasso: clause } });
    ws.apply([{ op: "remove", id: "n1" }]);
    expect(co.readCoordination("filter", "B")).toEqual({});
  });

  test("an adopted document that removed an element (a remote raw patch) drops its contribution too", () => {
    const { co, ws } = fresh();
    const clause = { op: "eq", column: "t", value: 1 } as const;
    co.assignScope("n2", "filter", "A");
    co.setCoordinationValue("filter", "A", { n2: { lasso: clause }, agent: { where: clause } });
    const { layouts, ...rest } = ws.snapshot();
    const { n2: _gone, ...elements } = layouts.main.spec.elements;
    elements.root = { ...elements.root, children: ["n1", "n3", "scatter"] };
    ws.applyDocument({ ...rest, layouts: { main: { ...layouts.main, spec: { root: "root", elements } } } });
    expect(co.readCoordination("filter", "A")).toEqual({ agent: { where: clause } });
  });
});

const coordinator = (rows: number[]) => ({ query: async () => rows.map((__row_index__) => ({ __row_index__ })) });

describe("filter binding (crossfilter)", () => {
  test("publish and clear edit only the member's own facet in the scope cell", () => {
    const { co } = fresh();
    co.assignScope("scatter", "filter", "A");
    co.setCoordinationValue("filter", "A", { agent: { where: { op: "eq", column: "infected", value: true } } });
    const scatter = createFilterBinding({
      elementId: "scatter",
      coordination: co,
      coordinator: coordinator([]),
      table: "t",
    });

    scatter.publish("range", { op: "between", column: "area", range: [1, 5] });
    expect(co.filterFacet("scatter", "range")).toEqual({ op: "between", column: "area", range: [1, 5] });
    expect(co.readCoordination("filter", "A")).toEqual({
      agent: { where: { op: "eq", column: "infected", value: true } },
      scatter: { range: { op: "between", column: "area", range: [1, 5] } },
    });
    scatter.clear("range");
    expect(co.readCoordination("filter", "A")).toEqual({
      agent: { where: { op: "eq", column: "infected", value: true } },
    });
  });

  test("an unbound element publishes nothing; materialization rejects a filter that moved", async () => {
    const { co, ws } = fresh();
    const binding = createFilterBinding({
      elementId: "n1",
      coordination: co,
      coordinator: coordinator([4, 7]),
      table: "t",
    });
    binding.publish("lasso", { op: "inSet", set: "0123456789abcdef" });
    expect(ws.snapshot().state).toEqual({});

    expect((await binding.materializeRowIds()).rowIds).toEqual([rowIndex(4), rowIndex(7)]);
    const pending = binding.materializeRowIds();
    binding.setPredicate("x > 1");
    await expect(pending).rejects.toThrow("filter changed");
  });

  test("setFilterFacet sets, replaces, and clears one source facet", () => {
    const agent: Record<string, FilterClause> = { where: { op: "eq", column: "infected", value: true } };
    const a: FilterClause = { op: "in", column: "fov", values: ["A"] };
    const b: FilterClause = { op: "in", column: "fov", values: ["B"] };
    const set = setFilterFacet({ agent }, "s", "select", a);
    expect(set).toEqual({ agent, s: { select: a } });
    expect(setFilterFacet(set, "s", "select", b)).toEqual({ agent, s: { select: b } });
    expect(setFilterFacet(set, "s", "select", null)).toEqual({ agent });
    const cell = { agent };
    expect(setFilterFacet(cell, "s", "select", null)).toBe(cell);
  });
});
