import { describe, expect, test } from "bun:test";

import { childRangesFor, type GroupSummary, headerIndexOf, layoutGroups, slotAt } from "./grouped-rows";

const groups: GroupSummary[] = [
  { key: 0, count: 3 },
  { key: 1, count: 2 },
  { key: 2, count: 4 },
];
const none = () => false;
const all = () => true;
const only =
  (...keys: (string | number)[]) =>
  (key: string | number) =>
    keys.includes(key);

describe("grouped row layout", () => {
  test("collapsed: one row per group and nothing else", () => {
    const layout = layoutGroups(groups, none);
    expect(layout.totalCount).toBe(3);
    expect(layout.headerAt).toEqual([0, 1, 2]);
    expect(slotAt(layout, 1)).toMatchObject({ kind: "header", groupIndex: 1 });
  });

  test("expanded groups contribute their SERVER count, not a loaded page", () => {
    const layout = layoutGroups(groups, all);
    // 3 headers + 3 + 2 + 4 children
    expect(layout.totalCount).toBe(12);
    expect(layout.headerAt).toEqual([0, 4, 7]);
  });

  test("mixed expansion offsets later groups correctly", () => {
    const layout = layoutGroups(groups, only(1));
    // g0 header, g1 header + 2 children, g2 header
    expect(layout.totalCount).toBe(5);
    expect(layout.headerAt).toEqual([0, 1, 4]);
    expect(slotAt(layout, 0)).toMatchObject({ kind: "header", groupIndex: 0 });
    expect(slotAt(layout, 2)).toMatchObject({ kind: "child", groupIndex: 1, childOffset: 0 });
    expect(slotAt(layout, 3)).toMatchObject({ kind: "child", groupIndex: 1, childOffset: 1 });
    expect(slotAt(layout, 4)).toMatchObject({ kind: "header", groupIndex: 2 });
  });

  test("every index in an expanded layout resolves, with no gaps or repeats", () => {
    const layout = layoutGroups(groups, all);
    const seen: string[] = [];
    for (let i = 0; i < layout.totalCount; i++) {
      const slot = slotAt(layout, i);
      expect(slot).toBeDefined();
      seen.push(slot?.kind === "header" ? `h${slot.groupIndex}` : `c${slot?.groupIndex}:${slot?.childOffset}`);
    }
    expect(seen).toEqual(["h0", "c0:0", "c0:1", "c0:2", "h1", "c1:0", "c1:1", "h2", "c2:0", "c2:1", "c2:2", "c2:3"]);
    expect(new Set(seen).size).toBe(seen.length);
  });

  test("out-of-range and empty inputs return undefined rather than a bogus slot", () => {
    const layout = layoutGroups(groups, all);
    expect(slotAt(layout, -1)).toBeUndefined();
    expect(slotAt(layout, layout.totalCount)).toBeUndefined();
    expect(slotAt(layoutGroups([], none), 0)).toBeUndefined();
  });

  test("an empty group still gets a header when expanded", () => {
    // Under a filter a group can legitimately have zero rows; it must not vanish.
    const layout = layoutGroups(
      [
        { key: "a", count: 0 },
        { key: "b", count: 1 },
      ],
      all,
    );
    expect(layout.totalCount).toBe(3);
    expect(slotAt(layout, 0)).toMatchObject({ kind: "header", groupIndex: 0 });
    expect(slotAt(layout, 1)).toMatchObject({ kind: "header", groupIndex: 1 });
  });

  test("headerIndexOf locates a group for scroll-to", () => {
    const layout = layoutGroups(groups, all);
    expect(headerIndexOf(layout, 2)).toBe(7);
    expect(headerIndexOf(layout, "missing")).toBeUndefined();
  });
});

describe("child range planning", () => {
  test("a range inside one group yields one fetch", () => {
    const layout = layoutGroups(groups, all);
    expect(childRangesFor(layout, 1, 3)).toEqual([{ groupIndex: 0, group: groups[0], from: 0, to: 2 }]);
  });

  test("a range spanning a boundary splits per group and skips headers", () => {
    const layout = layoutGroups(groups, all);
    // indices 2..6 = c0:1, c0:2, h1, c1:0, c1:1
    expect(childRangesFor(layout, 2, 6)).toEqual([
      { groupIndex: 0, group: groups[0], from: 1, to: 2 },
      { groupIndex: 1, group: groups[1], from: 0, to: 1 },
    ]);
  });

  test("a range of only headers fetches nothing", () => {
    const layout = layoutGroups(groups, none);
    expect(childRangesFor(layout, 0, 2)).toEqual([]);
  });

  test("a range past the end clamps instead of over-fetching", () => {
    const layout = layoutGroups(groups, all);
    const ranges = childRangesFor(layout, 8, 999);
    expect(ranges).toEqual([{ groupIndex: 2, group: groups[2], from: 0, to: 3 }]);
  });
});
