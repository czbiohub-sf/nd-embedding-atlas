import { Store } from "@tanstack/store";
import { describe, expect, test } from "bun:test";
import { rowIndex, type RowIndex } from "@ndea/sdk";

import {
  coordinationDocumentPort,
  createCoordination,
  withoutNodeCoordination,
  type CoordinationDocumentState,
  type CoordinationScopeCellPort,
} from "./coordination";
import { createFilterBinding } from "./filter-binding";
import { parseWorkspaceDocument } from "../workspace/document";

function fresh(): { co: CoordinationScopeCellPort; store: Store<CoordinationDocumentState> } {
  const store = new Store<CoordinationDocumentState>({ state: {}, bindings: {} });
  return { co: createCoordination(coordinationDocumentPort(store)), store };
}

describe("coordination cells", () => {
  test("bound nodes share one cell; scopes are independent", () => {
    const { co } = fresh();
    co.assignScope("n1", "focus", "A");
    co.assignScope("n2", "focus", "A");
    co.assignScope("n3", "focus", "B");
    co.setCoordinationValue("focus", "A", rowIndex(8));
    expect(co.readCoordination("focus", co.scopeOf("n2", "focus")!)).toBe(rowIndex(8));
    expect(co.readCoordination("focus", co.scopeOf("n3", "focus")!)).toBeNull();
  });

  test("binding is a json-render $bindState pointer, and the cell is seeded for agent patches", () => {
    const { co, store } = fresh();
    co.assignScope("n1", "filter", "A");
    expect(store.state.bindings.n1).toEqual({ filter: { $bindState: "/filter/A" } });
    expect(store.state.state.filter).toEqual({ A: {} });
    co.clearScope("n1", "filter");
    expect(store.state.bindings.n1).toBeUndefined();
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

  test("existingScopes and mintScope see bound scopes and agent-written cells", () => {
    const { co } = fresh();
    co.assignScope("n1", "focus", "A");
    co.setCoordinationValue("focus", "B", null);
    expect(co.existingScopes("focus")).toEqual(["A", "B"]);
    expect(co.mintScope("focus")).toBe("C");
  });

  test("leaving a filter scope or deleting the node drops its crossfilter contribution", () => {
    const { co, store } = fresh();
    const clause = { op: "eq", column: "t", value: 1 } as const;
    co.assignScope("n1", "filter", "A");
    co.setCoordinationValue("filter", "A", { n1: { lasso: clause }, agent: { where: clause } });
    co.assignScope("n1", "filter", "B");
    expect(store.state.state.filter?.A).toEqual({ agent: { where: clause } });

    co.setCoordinationValue("filter", "B", { n1: { lasso: clause } });
    const removed = withoutNodeCoordination(store.state, "n1");
    expect(removed.state.filter?.B).toEqual({});
    expect(removed.bindings.n1).toBeUndefined();
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

  test("an unbound node publishes nothing; materialization rejects a filter that moved", async () => {
    const { co } = fresh();
    const binding = createFilterBinding({
      nodeId: "n1",
      coordination: co,
      coordinator: coordinator([4, 7]),
      table: "t",
    });
    binding.publish("lasso", { op: "inSet", set: "0123456789abcdef" });
    expect(co.existingScopes("filter")).toEqual([]);

    expect((await binding.materializeRowIds()).rowIds).toEqual([rowIndex(4), rowIndex(7)]);
    const pending = binding.materializeRowIds();
    binding.setGraphPredicate("x > 1");
    await expect(pending).rejects.toThrow("filter changed");
  });
});

const document = (coordination: object) => ({
  nodeAssets: [],
  nodes: {},
  edges: {},
  positions: {},
  sizeOverrides: {},
  formOverride: {},
  formLocked: {},
  stage: null,
  stripH: 280,
  flags: {},
  state: {},
  bindings: {},
  ...coordination,
});
const pointers = (value: unknown) => {
  const parsed = parseWorkspaceDocument(value);
  return parsed.ok ? [] : parsed.issues.map((issue) => issue.pointer);
};

describe("document validation of coordination sections", () => {
  test("agent patches are checked against each type's value schema", () => {
    expect(pointers(document({ state: { focus: { A: 3 } } }))).toEqual([]);
    expect(pointers(document({ state: { focus: { A: -1 } } }))).toEqual(["/state/focus/A"]);
    expect(pointers(document({ state: { filter: { A: { agent: { where: { op: "inSet", set: "x" } } } } } }))).toEqual([
      "/state/filter/A/agent/where/set",
    ]);
    expect(pointers(document({ state: { focs: {} } }))).toEqual(["/state"]);
  });

  test("bindings must name a live node and point at /<type>/<scope>", () => {
    expect(pointers(document({ bindings: { ghost: { focus: { $bindState: "/focus/A" } } } }))).toEqual([
      "/bindings/ghost",
    ]);
    const node = { id: "n1", definitionRef: { nodeTypeId: "table", nodeTypeVersion: "1.0.0" }, label: "Table" };
    expect(
      pointers(document({ nodes: { n1: node }, bindings: { n1: { focus: { $bindState: "/filter/A" } } } })),
    ).toEqual(["/bindings/n1/focus/$bindState"]);
  });
});
