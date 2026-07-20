/**
 * Stage split-tree: tmux/Dockview model, hand-rolled (C3 spike resolution).
 * A tree node is either a leaf (node id, or "__slot-N" for an empty slot)
 * or { dir, ratio, a, b }. Splitting a tile replaces its leaf with a split
 * whose other half is an empty slot; removing a leaf collapses its split
 * (the sibling absorbs the space). Sashes live at every split seam and
 * adjust that split's ratio only: the rest of the stage holds its ratios.
 *
 * Pure functions; ported 1:1 from the design prototype (proto-stage.jsx).
 */

export type SplitDir = "row" | "col";
export type SplitWord = "left" | "right" | "up" | "down";

export interface TreeSplit {
  dir: SplitDir;
  /** share of the `a` child, 0..1 */
  ratio: number;
  a: TreeNode;
  b: TreeNode;
}
export type TreeNode = string | TreeSplit;

export const isSlot = (leaf: string): boolean => leaf.startsWith("__slot-");

export function treeLeaves(t: TreeNode | null): string[] {
  if (t === null) return [];
  return typeof t === "string" ? [t] : [...treeLeaves(t.a), ...treeLeaves(t.b)];
}

export function treeHas(t: TreeNode | null, id: string): boolean {
  return treeLeaves(t).includes(id);
}

export function treeMapLeaves(t: TreeNode | null, fn: (leaf: string) => string): TreeNode | null {
  if (t === null) return null;
  if (typeof t === "string") return fn(t);
  return { ...t, a: treeMapLeaves(t.a, fn) as TreeNode, b: treeMapLeaves(t.b, fn) as TreeNode };
}

/** replace leaf `id` with a split; the new leaf sits on the chosen side */
export function treeSplitLeaf(t: TreeNode | null, id: string, dir: SplitWord, newId: string): TreeNode | null {
  if (t === null) return t;
  if (typeof t === "string") {
    if (t !== id) return t;
    if (dir === "left") return { dir: "row", ratio: 0.5, a: newId, b: id };
    if (dir === "right") return { dir: "row", ratio: 0.5, a: id, b: newId };
    if (dir === "up") return { dir: "col", ratio: 0.5, a: newId, b: id };
    return { dir: "col", ratio: 0.5, a: id, b: newId };
  }
  return { ...t, a: treeSplitLeaf(t.a, id, dir, newId) as TreeNode, b: treeSplitLeaf(t.b, id, dir, newId) as TreeNode };
}

/** remove a leaf; its sibling absorbs the space (the split collapses) */
export function treeRemove(t: TreeNode | null, id: string): TreeNode | null {
  if (t === null) return null;
  if (typeof t === "string") return t === id ? null : t;
  const a = treeRemove(t.a, id);
  const b = treeRemove(t.b, id);
  if (a === null) return b;
  if (b === null) return a;
  return { ...t, a, b };
}

export function treeSwap(t: TreeNode | null, x: string, y: string): TreeNode | null {
  return treeMapLeaves(t, (l) => (l === x ? y : l === y ? x : l));
}

/** set the ratio of the split at `path` ("a"/"b" steps from the root) */
export function treeSetRatio(t: TreeNode | null, path: string, ratio: number): TreeNode | null {
  if (t === null || typeof t === "string") return t;
  if (path === "") return { ...t, ratio };
  return path[0] === "a"
    ? { ...t, a: treeSetRatio(t.a, path.slice(1), ratio) as TreeNode }
    : { ...t, b: treeSetRatio(t.b, path.slice(1), ratio) as TreeNode };
}

/** default disposition: first staged node gets the big left slot (0.42),
 *  the rest stack right in equal rows */
export function buildDefaultTree(ids: string[]): TreeNode | null {
  if (!ids.length) return null;
  if (ids.length === 1) return ids[0];
  const [first, ...rest] = ids;
  let col: TreeNode = rest[rest.length - 1];
  for (let i = rest.length - 2; i >= 0; i--) col = { dir: "col", ratio: 1 / (rest.length - i), a: rest[i], b: col };
  return { dir: "row", ratio: 0.42, a: first, b: col };
}

/** reconcile layout memory with the live staged set: departed tiles drop
 *  (slots persist), arrivals join: into the default disposition when the
 *  stage was empty, else as a right-hand split */
export function reconcileStageTree(t: TreeNode | null, stagedIds: string[]): TreeNode | null {
  let out = t;
  for (const leaf of treeLeaves(t)) {
    if (!isSlot(leaf) && !stagedIds.includes(leaf)) out = treeRemove(out, leaf);
  }
  const missing = stagedIds.filter((id) => !treeHas(out, id));
  if (missing.length) {
    if (out === null) out = buildDefaultTree(missing);
    else for (const id of missing) out = { dir: "row", ratio: 0.62, a: out, b: id };
  }
  return out;
}
