import { describe, expect, test } from "bun:test";

import { compareDocuments } from "./compare";

const before = {
  data: { infected: { sql: "infected" }, old: { sql: "x" } },
  spec: {
    root: "split-1",
    elements: {
      "split-1": { type: "split", props: { ratio: 0.5 }, children: ["scatter-1", "slot-1"] },
      "scatter-1": { type: "scatter", props: { colorBy: "leiden" }, children: [] },
      "slot-1": { type: "slot", props: {}, children: [] },
    },
  },
  state: { filter: { main: {} } },
};

describe("compareDocuments", () => {
  test("summarizes element, data, and state changes", () => {
    const after = {
      data: { infected: { sql: "infected = 1" } },
      spec: {
        root: "split-1",
        elements: {
          "split-1": { type: "split", props: { ratio: 0.5 }, children: ["scatter-1", "slot-1", "text-1"] },
          "scatter-1": { type: "scatter", props: { colorBy: "predicted_infection_state" }, children: [] },
          "slot-1": { type: "count", props: {}, children: [] },
          "text-1": { type: "text", props: {}, children: [] },
        },
      },
      state: { filter: { main: { "scatter-1": {} } }, focus: { main: null } },
    };

    expect(compareDocuments(before, after)).toEqual(
      expect.arrayContaining([
        { section: "element", key: "scatter-1", change: "props" },
        { section: "element", key: "slot-1", change: "type" },
        { section: "element", key: "text-1", change: "added" },
        { section: "element", key: "split-1", change: "children" },
        { section: "data", key: "old", change: "removed" },
        { section: "data", key: "infected", change: "changed" },
        { section: "state", key: "focus", change: "added" },
        { section: "state", key: "filter/main", change: "changed" },
      ]),
    );
    expect(compareDocuments(after, before)).toContainEqual({ section: "element", key: "text-1", change: "removed" });
  });

  test("identical documents have no changes", () => {
    expect(compareDocuments(before, structuredClone(before))).toEqual([]);
  });
});
