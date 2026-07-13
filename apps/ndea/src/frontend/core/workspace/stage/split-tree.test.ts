import { describe, expect, test } from "bun:test";

import {
  buildDefaultTree,
  reconcileStageTree,
  treeHas,
  treeLeaves,
  treeRemove,
  treeSetRatio,
  treeSplitLeaf,
  treeSwap,
  type TreeNode,
} from "./split-tree";

describe("split-tree", () => {
  test("buildDefaultTree: single id is a bare leaf", () => {
    expect(buildDefaultTree(["a"])).toBe("a");
  });

  test("buildDefaultTree: first id gets the big left slot, rest stack right", () => {
    const t = buildDefaultTree(["a", "b", "c"]) as Exclude<TreeNode, string>;
    expect(t.dir).toBe("row");
    expect(t.ratio).toBeCloseTo(0.42);
    expect(t.a).toBe("a");
    expect(treeLeaves(t.b)).toEqual(["b", "c"]);
  });

  test("treeSplitLeaf places the new leaf on the chosen side", () => {
    expect(treeSplitLeaf("a", "a", "right", "__slot-1")).toEqual({ dir: "row", ratio: 0.5, a: "a", b: "__slot-1" });
    expect(treeSplitLeaf("a", "a", "left", "__slot-1")).toEqual({ dir: "row", ratio: 0.5, a: "__slot-1", b: "a" });
    expect(treeSplitLeaf("a", "a", "up", "__slot-1")).toEqual({ dir: "col", ratio: 0.5, a: "__slot-1", b: "a" });
    expect(treeSplitLeaf("a", "a", "down", "__slot-1")).toEqual({ dir: "col", ratio: 0.5, a: "a", b: "__slot-1" });
  });

  test("treeRemove collapses the split — sibling absorbs the space", () => {
    const t: TreeNode = { dir: "row", ratio: 0.42, a: "a", b: { dir: "col", ratio: 0.5, a: "b", b: "c" } };
    expect(treeRemove(t, "b")).toEqual({ dir: "row", ratio: 0.42, a: "a", b: "c" });
    expect(treeRemove("a", "a")).toBeNull();
  });

  test("treeSwap exchanges two leaves in place", () => {
    const t: TreeNode = { dir: "row", ratio: 0.42, a: "a", b: "b" };
    expect(treeSwap(t, "a", "b")).toEqual({ dir: "row", ratio: 0.42, a: "b", b: "a" });
  });

  test("treeSetRatio targets the split at a path", () => {
    const t: TreeNode = { dir: "row", ratio: 0.42, a: "a", b: { dir: "col", ratio: 0.5, a: "b", b: "c" } };
    const out = treeSetRatio(t, "b", 0.7) as Exclude<TreeNode, string>;
    expect((out.b as Exclude<TreeNode, string>).ratio).toBeCloseTo(0.7);
    expect((treeSetRatio(t, "", 0.6) as Exclude<TreeNode, string>).ratio).toBeCloseTo(0.6);
  });

  test("reconcile: departed tiles drop, slots persist, arrivals join right", () => {
    const t: TreeNode = { dir: "row", ratio: 0.42, a: "a", b: "__slot-1" };
    const out = reconcileStageTree(t, ["b"]);
    expect(treeHas(out, "a")).toBe(false);
    expect(treeHas(out, "__slot-1")).toBe(true);
    expect(treeHas(out, "b")).toBe(true);
  });

  test("reconcile: empty memory builds the default disposition", () => {
    const out = reconcileStageTree(null, ["x", "y"]);
    expect(treeLeaves(out)).toEqual(["x", "y"]);
    expect((out as Exclude<TreeNode, string>).ratio).toBeCloseTo(0.42);
  });

  test("reconcile: stable when nothing changed", () => {
    const t: TreeNode = { dir: "row", ratio: 0.42, a: "a", b: "b" };
    expect(reconcileStageTree(t, ["a", "b"])).toEqual(t);
  });
});
