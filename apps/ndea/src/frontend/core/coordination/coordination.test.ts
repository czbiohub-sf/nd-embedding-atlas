import { Store } from "@tanstack/store";
import { describe, expect, test } from "bun:test";
import { rowIndex, type RowIndex } from "@ndea/sdk";

import {
  coordinationDocumentPort,
  createCoordination,
  withoutRemovedContributions,
  type CoordinationDocumentState,
  type CoordinationScopeCellPort,
} from "./coordination";
import { createFilterBinding } from "./filter-binding";
import { removeElement } from "../workspace/dashboard";

const leaf = { type: "table", props: {}, children: [] };

function fresh(): { co: CoordinationScopeCellPort; store: Store<CoordinationDocumentState> } {
  const store = new Store<CoordinationDocumentState>({
    state: {},
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
  });
  return { co: createCoordination(coordinationDocumentPort(store)), store };
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

  test("binding is a json-render $bindState prop, and the cell is seeded for agent patches", () => {
    const { co, store } = fresh();
    co.assignScope("n1", "filter", "A");
    expect(store.state.spec.elements.n1.props.filter).toEqual({ $bindState: "/filter/A" });
    expect(store.state.state.filter).toEqual({ A: {} });
    co.clearScope("n1", "filter");
    expect(store.state.spec.elements.n1.props).toEqual({});
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
    const { co, store } = fresh();
    const clause = { op: "eq", column: "t", value: 1 } as const;
    co.assignScope("n1", "filter", "A");
    co.setCoordinationValue("filter", "A", { n1: { lasso: clause }, agent: { where: clause } });
    co.assignScope("n1", "filter", "B");
    expect(store.state.state.filter?.A).toEqual({ agent: { where: clause } });

    co.setCoordinationValue("filter", "B", { n1: { lasso: clause } });
    const next = { ...store.state, spec: removeElement(store.state.spec, "n1") };
    expect(withoutRemovedContributions(store.state, next).state.filter?.B).toEqual({});
  });
});

const coordinator = (rows: number[]) => ({ query: async () => rows.map((__row_index__) => ({ __row_index__ })) });

describe("filter binding (crossfilter)", () => {
  test("publish and clear edit only the member's own facet in the scope cell", () => {
    const { co } = fresh();
    co.assignScope("scatter", "filter", "A");
    co.setCoordinationValue("filter", "A", { agent: { where: { op: "eq", column: "infected", value: true } } });
    const scatter = createFilterBinding({
      nodeId: "scatter",
      coordination: co,
      coordinator: coordinator([]),
      table: "t",
    });

    scatter.publish("range", { op: "between", column: "area", range: [1, 5] });
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
    const { co, store } = fresh();
    const binding = createFilterBinding({
      nodeId: "n1",
      coordination: co,
      coordinator: coordinator([4, 7]),
      table: "t",
    });
    binding.publish("lasso", { op: "inSet", set: "0123456789abcdef" });
    expect(store.state.state).toEqual({});

    expect((await binding.materializeRowIds()).rowIds).toEqual([rowIndex(4), rowIndex(7)]);
    const pending = binding.materializeRowIds();
    binding.setGraphPredicate("x > 1");
    await expect(pending).rejects.toThrow("filter changed");
  });
});
