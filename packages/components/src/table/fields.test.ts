/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import type { FilterClause } from "@ndea/protocol";

import {
  clauseConditions,
  clauseConjunction,
  conditionsClause,
  countBits,
  emptyBits,
  fieldType,
  GroupLayout,
  groupKey,
  hasBit,
  orderBySql,
  searchSql,
  withBits,
} from "./fields";
import type { Condition, Group, GroupValue, TableItem } from "./fields";

describe("field types", () => {
  test("annotation dtype wins; strings split on distinct count", () => {
    expect(fieldType("string", 3, "label")).toBe("label");
    expect(fieldType("string", undefined, "text")).toBe("text");
    expect(fieldType("number", undefined, null)).toBe("number");
    expect(fieldType("string", 12, null)).toBe("category");
    expect(fieldType("string", 50_000, null)).toBe("text");
  });
});

describe("filter builder", () => {
  const typeOf = (c: string) => ({ area: "number", state: "category", ok: "boolean" })[c] as never;

  test("complete conditions AND into typed clauses and decode back", () => {
    const conditions = [
      { column: "area", op: "gt", value: "40" },
      { column: "state", op: "eq", value: "infected" },
      { column: "ok", op: "eq", value: "true" },
      { column: "area", op: "lt", value: "" },
    ] as const;
    const clause = conditionsClause(conditions, typeOf);
    expect(clause).toEqual({
      op: "and",
      clauses: [
        { op: "gt", column: "area", value: 40 },
        { op: "eq", column: "state", value: "infected" },
        { op: "eq", column: "ok", value: true },
      ],
    });
    expect(clauseConditions(clause!)).toEqual([
      { column: "area", op: "gt", value: "40" },
      { column: "state", op: "eq", value: "infected" },
      { column: "ok", op: "eq", value: "true" },
    ]);
  });

  test("one condition publishes itself; none publishes nothing", () => {
    expect(conditionsClause([{ column: "state", op: "isNull", value: "" }], typeOf)).toEqual({
      op: "isNull",
      column: "state",
    });
    expect(conditionsClause([{ column: "area", op: "gt", value: "x" }], typeOf)).toBeNull();
  });

  test("or joins any condition and decodes back with its conjunction", () => {
    const conditions: Condition[] = [
      { column: "state", op: "eq", value: "infected" },
      { column: "area", op: "gt", value: "40" },
    ];
    const clause = conditionsClause(conditions, typeOf, "or");
    expect(clause).toEqual({
      op: "or",
      clauses: [
        { op: "eq", column: "state", value: "infected" },
        { op: "gt", column: "area", value: 40 },
      ],
    });
    expect(clauseConjunction(clause!)).toBe("or");
    expect(clauseConditions(clause!)).toEqual(conditions);
    // A nested group the builder can't show is dropped, not flattened into the wrong conjunction.
    const gt: FilterClause = { op: "gt", column: "area", value: 40 };
    expect(clauseConditions({ op: "and", clauses: [{ op: "or", clauses: [clause!] }, gt] })).toEqual([conditions[1]]);
  });
});

describe("query SQL", () => {
  test("order: group, sort, row order", () => {
    expect(orderBySql({ col: 'a"b', dir: "desc" }, ["g", "h"])).toBe(
      '"g" ASC NULLS LAST, "h" ASC NULLS LAST, "a""b" DESC NULLS LAST, __row_index__',
    );
    expect(orderBySql(null, [])).toBe("__row_index__");
  });

  test("search escapes quotes and LIKE wildcards", () => {
    expect(searchSql("  ", ["a"])).toBeNull();
    expect(searchSql("o'k_1%", ["a", "b"])).toBe(
      `"a" ILIKE '%o''k\\_1\\%%' ESCAPE '\\' OR "b" ILIKE '%o''k\\_1\\%%' ESCAPE '\\'`,
    );
  });
});

describe("grouped layout", () => {
  const groups: Group[] = [
    { values: ["a", "x"], count: 2 },
    { values: ["a", "y"], count: 1 },
    { values: ["b", "x"], count: 3 },
  ];
  const header = (values: GroupValue[], count: number, level: number, collapsed = false): TableItem => ({
    kind: "group",
    group: { values, count },
    level,
    collapsed,
  });
  const row = (position: number, count: number, g: number): TableItem => ({
    kind: "row",
    position,
    count,
    group: groups[g],
  });
  const items = (layout: GroupLayout) => Array.from({ length: layout.length }, (_, i) => layout.item(i));

  test("a header opens each level when its value changes; rows follow the innermost one", () => {
    const layout = new GroupLayout(groups, new Set());
    expect(items(layout)).toEqual([
      header(["a"], 3, 0),
      header(["a", "x"], 2, 1),
      row(0, 1, 0),
      row(1, 1, 0),
      header(["a", "y"], 1, 1),
      row(2, 1, 1),
      header(["b"], 3, 0),
      header(["b", "x"], 3, 1),
      row(3, 1, 2),
      row(4, 1, 2),
      row(5, 1, 2),
    ]);
    expect(layout.indexOf(2)).toBe(5);
    expect(layout.indexOf(4)).toBe(9);
  });

  test("a collapsed header hides every level and row under it", () => {
    const layout = new GroupLayout(groups, new Set([groupKey(["a"]), groupKey(["b", "x"])]));
    expect(items(layout)).toEqual([header(["a"], 3, 0, true), header(["b"], 3, 0), header(["b", "x"], 3, 1, true)]);
    expect(layout.indexOf(1)).toBe(0);
    expect(layout.indexOf(2)).toBe(0);
    expect(layout.indexOf(5)).toBe(2);
  });

  test("lines of several rows wrap inside each group", () => {
    const layout = new GroupLayout(
      [
        { values: ["a"], count: 5 },
        { values: ["b"], count: 2 },
      ],
      new Set(),
      2,
    );
    expect(layout.length).toBe(1 + 3 + 1 + 1);
    expect([1, 2, 3, 5].map((i) => layout.item(i))).toMatchObject([
      { kind: "row", position: 0, count: 2 },
      { kind: "row", position: 2, count: 2 },
      { kind: "row", position: 4, count: 1 },
      { kind: "row", position: 5, count: 2 },
    ]);
    expect(layout.indexOf(4)).toBe(3);
    expect(layout.indexOf(6)).toBe(5);
  });

  test("strips: each innermost group is one line under its outer headers", () => {
    const layout = new GroupLayout(groups, new Set(), Infinity);
    expect(items(layout)).toEqual([header(["a"], 3, 0), row(0, 2, 0), row(2, 1, 1), header(["b"], 3, 0), row(3, 3, 2)]);
    expect(layout.indexOf(4)).toBe(4);
  });

  test("keys tell composite values apart", () => {
    expect(groupKey(["a", null])).not.toBe(groupKey(["a", "null"]));
  });
});

describe("selection bits", () => {
  test("set, clear, count", () => {
    let bits = withBits(emptyBits(70), [0, 31, 32, 69], true);
    expect(countBits(bits)).toBe(4);
    expect(hasBit(bits, 31)).toBe(true);
    bits = withBits(bits, [31], false);
    expect(hasBit(bits, 31)).toBe(false);
    expect(countBits(bits)).toBe(3);
  });
});
