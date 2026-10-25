/// <reference types="bun" />
import { describe, expect, test } from "bun:test";

import {
  clauseConditions,
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
});

describe("query SQL", () => {
  test("order: group, sort, row order", () => {
    expect(orderBySql({ col: 'a"b', dir: "desc" }, "g")).toBe(
      '"g" ASC NULLS LAST, "a""b" DESC NULLS LAST, __row_index__',
    );
    expect(orderBySql(null, null)).toBe("__row_index__");
  });

  test("search escapes quotes and LIKE wildcards", () => {
    expect(searchSql("  ", ["a"])).toBeNull();
    expect(searchSql("o'k_1%", ["a", "b"])).toBe(
      `"a" ILIKE '%o''k\\_1\\%%' ESCAPE '\\' OR "b" ILIKE '%o''k\\_1\\%%' ESCAPE '\\'`,
    );
  });
});

describe("grouped layout", () => {
  const groups = [
    { value: "a", count: 2 },
    { value: null, count: 3 },
    { value: "c", count: 1 },
  ];

  test("headers interleave expanded rows; collapsed groups are just a header", () => {
    const layout = new GroupLayout(groups, new Set([groupKey(null)]));
    expect(layout.length).toBe(1 + 2 + 1 + 1 + 1);
    expect([0, 1, 2, 3, 4, 5].map((i) => layout.item(i))).toEqual([
      { kind: "group", group: groups[0], collapsed: false },
      { kind: "row", position: 0 },
      { kind: "row", position: 1 },
      { kind: "group", group: groups[1], collapsed: true },
      { kind: "group", group: groups[2], collapsed: false },
      { kind: "row", position: 5 },
    ]);
    expect(layout.indexOf(1)).toBe(2);
    expect(layout.indexOf(3)).toBe(3);
    expect(layout.indexOf(5)).toBe(5);
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
