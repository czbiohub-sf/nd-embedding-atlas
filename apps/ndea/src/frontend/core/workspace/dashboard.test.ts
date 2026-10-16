import { describe, expect, test } from "bun:test";

import { removeElement, splitElement, swapElements } from "./dashboard";
import { dataSourceSql, elementPredicate } from "./data-sources";
import { emptyWorkspaceDocument, parseWorkspaceDocument } from "./document";

const pointers = (value: unknown) => {
  const parsed = parseWorkspaceDocument(value);
  return parsed.ok ? [] : parsed.issues.map((issue) => `${issue.pointer} ${issue.detail}`);
};

const withElements = (elements: Record<string, unknown>, extra: object = {}) => ({
  ...emptyWorkspaceDocument(),
  spec: {
    root: "root",
    elements: { root: { type: "stack", props: {}, children: Object.keys(elements) }, ...elements },
  },
  ...extra,
});

describe("dashboard validation", () => {
  test("component props are checked against the component's contract, with pointers", () => {
    const doc = withElements({ t: { type: "table", props: { columns: "x" }, children: [] } });
    expect(pointers(doc)[0]).toStartWith("/spec/elements/t/props/columns");
  });

  test("unknown types, data sources, and malformed bindings are rejected", () => {
    const doc = withElements({
      a: { type: "tabel", props: {}, children: [] },
      b: { type: "count", props: { data: "ghost" }, children: [] },
      c: { type: "table", props: { focus: { $bindState: "/filter/A" } }, children: [] },
      d: { type: "text", props: { text: "hi", filter: { $bindState: "/filter/A" } }, children: [] },
    });
    const issues = pointers(doc).map((issue) => issue.split(" ")[0]);
    expect(issues).toEqual([
      "/spec/elements/a/type",
      "/spec/elements/b/props/data",
      "/spec/elements/c/props/focus",
      "/spec/elements/d/props/filter",
    ]);
  });

  test("structure: splits take two children, leaves none, and every element is reachable once", () => {
    const doc = {
      ...emptyWorkspaceDocument(),
      spec: {
        root: "s",
        elements: {
          s: { type: "split", props: { direction: "row", ratio: 0.5 }, children: ["t", "t"] },
          t: { type: "text", props: { text: "x" }, children: ["orphan"] },
          orphan: { type: "slot", props: {}, children: [] },
        },
      },
    };
    expect(pointers(doc).map((issue) => issue.split(" ")[0])).toEqual([
      "/spec/elements/s/children/1",
      "/spec/elements/t/children",
    ]);
  });
});

describe("data sources", () => {
  const data = {
    infected: { where: { op: "eq" as const, column: "state", value: "infected" } },
    large: { from: "infected", sql: "area > 10" },
  };

  test("a source narrows its `from` chain; cycles are rejected", () => {
    const sql = dataSourceSql(data, "large")!;
    expect(sql).toContain(`"state" = 'infected'`);
    expect(sql).toContain("area > 10");
    const cyclic = { ...emptyWorkspaceDocument(), data: { a: { from: "b" }, b: { from: "a" } } };
    expect(pointers(cyclic)).toContain('/data/a/from data source "a" depends on itself');
  });

  test("an element sees its source AND every other scope member's clauses, never its own", () => {
    const cell = {
      me: { lasso: { op: "eq" as const, column: "x", value: 1 } },
      other: { chart: { op: "eq" as const, column: "y", value: 2 } },
    };
    const sql = elementPredicate(data, "infected", cell, "me")!;
    expect(sql).toContain(`"state" = 'infected'`);
    expect(sql).toContain(`"y" = 2`);
    expect(sql).not.toContain(`"x"`);
  });
});

describe("dashboard operations", () => {
  const base = {
    root: "s",
    elements: {
      s: { type: "split", props: { direction: "row", ratio: 0.5 }, children: ["a", "b"] },
      a: { type: "text", props: { text: "a" }, children: [] },
      b: { type: "text", props: { text: "b" }, children: [] },
    },
  };

  test("split inserts a slot beside the element; removing it collapses the split", () => {
    const [split, slot] = splitElement(base, "a", "up");
    expect(split.elements[split.elements.s.children[0]]).toMatchObject({ type: "split", children: [slot, "a"] });
    expect(removeElement(split, slot!)).toEqual(base);
  });

  test("swap exchanges positions; removing the root leaves an empty slot", () => {
    expect(swapElements(base, "a", "b").elements.s.children).toEqual(["b", "a"]);
    expect(removeElement(base, "s")).toEqual({
      root: "slot-1",
      elements: { "slot-1": { type: "slot", props: {}, children: [] } },
    });
  });
});
