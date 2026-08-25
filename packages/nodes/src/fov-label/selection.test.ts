import { describe, expect, test } from "bun:test";
import {
  applyClick,
  applyGroupClick,
  EMPTY_SELECTION,
  labelTargets,
  pruneSelection,
  type SelectionState,
} from "./selection";

/** Visual order; deliberately NOT ascending, to catch code that assumes row index order. */
const ORDER = [10, 20, 30, 40, 50];
const plain = { shift: false, toggle: false };
const shift = { shift: true, toggle: false };
const toggle = { shift: false, toggle: true };

const sel = (ids: number[], anchor: number | null): SelectionState => ({ selected: new Set(ids), anchor });
/** Compare as a set: order is not part of the contract, and sorting needs a newer lib target. */
const ids = (s: SelectionState) => s.selected;
const setOf = (...values: number[]) => new Set(values);

describe("applyClick", () => {
  test("a plain click selects exactly one and sets the anchor", () => {
    const next = applyClick(sel([10, 20, 30], 10), ORDER, 40, plain);
    expect(ids(next)).toEqual(setOf(40));
    expect(next.anchor).toBe(40);
  });

  test("toggle adds and removes without disturbing the rest", () => {
    const added = applyClick(sel([20], 20), ORDER, 40, toggle);
    expect(ids(added)).toEqual(setOf(20, 40));
    const removed = applyClick(added, ORDER, 20, toggle);
    expect(ids(removed)).toEqual(setOf(40));
  });

  test("shift selects the visual range, in either direction", () => {
    const forward = applyClick(sel([20], 20), ORDER, 40, shift);
    expect(ids(forward)).toEqual(setOf(20, 30, 40));
    const backward = applyClick(sel([40], 40), ORDER, 20, shift);
    expect(ids(backward)).toEqual(setOf(20, 30, 40));
  });

  test("the range follows visual order, not numeric row index", () => {
    // Ranked layout: the same cells in a different on-screen order must select what is
    // between them ON SCREEN. Sorting by row index here would pick 20 and 30 instead.
    const ranked = [50, 10, 40, 20, 30];
    const next = applyClick(sel([50], 50), ranked, 40, shift);
    expect(ids(next)).toEqual(setOf(10, 40, 50));
  });

  test("the anchor stays put so the far end of a range can be dragged", () => {
    const first = applyClick(sel([20], 20), ORDER, 40, shift);
    expect(first.anchor).toBe(20);
    const shrunk = applyClick(first, ORDER, 30, shift);
    expect(ids(shrunk)).toEqual(setOf(20, 30));
  });

  test("a plain shift-click replaces the range rather than accumulating", () => {
    // Accumulating would make a range impossible to shrink without clearing first.
    const wide = applyClick(sel([10], 10), ORDER, 50, shift);
    expect(ids(wide)).toEqual(setOf(10, 20, 30, 40, 50));
    const narrow = applyClick(wide, ORDER, 20, shift);
    expect(ids(narrow)).toEqual(setOf(10, 20));
  });

  test("shift plus toggle adds a range to the existing selection", () => {
    const state = applyClick(sel([50], 30), ORDER, 40, { shift: true, toggle: true });
    expect(ids(state)).toEqual(setOf(30, 40, 50));
  });

  test("shift with no anchor behaves like a plain click", () => {
    // Guessing an origin would select a swathe the user never indicated.
    const next = applyClick(EMPTY_SELECTION, ORDER, 30, shift);
    expect(ids(next)).toEqual(setOf(30));
    expect(next.anchor).toBe(30);
  });

  test("shift from an anchor that has left the view falls back to a single select", () => {
    const next = applyClick(sel([999], 999), ORDER, 30, shift);
    expect(ids(next)).toEqual(setOf(30));
  });
});

describe("applyGroupClick", () => {
  // A well in the tree rail. The rail must go through here rather than assigning the row set
  // itself: the previous implementation did `{ selected, anchor: rows.at(-1) }`, which put the
  // anchor on whatever the expansion loop happened to visit last.
  const well = [20, 30, 40];

  test("selects every field in the well", () => {
    expect(ids(applyGroupClick(EMPTY_SELECTION, ORDER, well, plain))).toEqual(setOf(20, 30, 40));
  });

  test("anchors on the well's FIRST field in visual order", () => {
    // Not the last, and not the caller's array order: a shift-click after picking a well must
    // extend from the top of that well, which is where the eye already is.
    expect(applyGroupClick(EMPTY_SELECTION, ORDER, [40, 20, 30], plain).anchor).toBe(20);
  });

  test("a following shift-click extends from the well's top, not from a random field", () => {
    const picked = applyGroupClick(EMPTY_SELECTION, ORDER, well, plain);
    expect(ids(applyClick(picked, ORDER, 50, shift))).toEqual(setOf(20, 30, 40, 50));
  });

  test("visual order decides membership, so ranked layout selects what is on screen", () => {
    const ranked = [50, 10, 40, 20, 30];
    const state = applyGroupClick(EMPTY_SELECTION, ranked, [40, 50], plain);
    expect(ids(state)).toEqual(setOf(40, 50));
    expect(state.anchor).toBe(50);
  });

  test("toggle adds the well to what is already selected", () => {
    expect(ids(applyGroupClick(sel([10], 10), ORDER, well, toggle))).toEqual(setOf(10, 20, 30, 40));
  });

  test("toggle on an already-complete well removes it, like toggling one cell", () => {
    const state = sel([10, 20, 30, 40], 10);
    expect(ids(applyGroupClick(state, ORDER, well, toggle))).toEqual(setOf(10));
  });

  test("toggle on a partially selected well completes it rather than clearing it", () => {
    // Clearing would make it impossible to finish selecting a well you started by hand.
    expect(ids(applyGroupClick(sel([30], 30), ORDER, well, toggle))).toEqual(setOf(20, 30, 40));
  });

  test("shift extends from the anchor through the well's far end", () => {
    expect(ids(applyGroupClick(sel([10], 10), ORDER, [30, 40], shift))).toEqual(setOf(10, 20, 30, 40));
  });

  test("shift plus toggle adds that span to the existing selection", () => {
    const state = applyGroupClick(sel([50], 50), ORDER, [10, 20], { shift: true, toggle: true });
    expect(ids(state)).toEqual(setOf(10, 20, 30, 40, 50));
  });

  test("an empty or fully-absent group is a no-op, returning the same object", () => {
    const state = sel([10], 10);
    expect(applyGroupClick(state, ORDER, [], plain)).toBe(state);
    expect(applyGroupClick(state, ORDER, [998, 999], plain)).toBe(state);
  });

  test("members not currently on screen are ignored rather than selected blind", () => {
    expect(ids(applyGroupClick(EMPTY_SELECTION, ORDER, [20, 999], plain))).toEqual(setOf(20));
  });
});

describe("labelTargets", () => {
  test("labelling inside a multi-selection applies to all of it", () => {
    expect(new Set(labelTargets(sel([10, 20, 30], 10), 20))).toEqual(setOf(10, 20, 30));
  });

  test("labelling outside the selection applies only to that cell", () => {
    // Otherwise a stale selection would be silently relabelled from a click elsewhere.
    expect(labelTargets(sel([10, 20], 10), 40)).toEqual([40]);
  });

  test("a single-cell selection labels just that cell", () => {
    expect(labelTargets(sel([10], 10), 10)).toEqual([10]);
  });

  test("no selection labels the clicked cell", () => {
    expect(labelTargets(EMPTY_SELECTION, 30)).toEqual([30]);
  });
});

describe("pruneSelection", () => {
  test("drops rows that no longer exist and clears a dangling anchor", () => {
    const next = pruneSelection(sel([10, 999], 999), new Set([10, 20]));
    expect(ids(next)).toEqual(setOf(10));
    expect(next.anchor).toBeNull();
  });

  test("returns the same object when nothing changed, so React can skip", () => {
    const state = sel([10, 20], 10);
    expect(pruneSelection(state, new Set([10, 20, 30]))).toBe(state);
  });
});
