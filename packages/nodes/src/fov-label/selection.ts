/**
 * Multi-select over the plate grid, so a run of fields can be labelled in one go.
 *
 * Ranges follow the VISUAL order, not the row index. In `plate` layout that is row-major
 * within each well; in `ranked` it is best-first by score. Shift-clicking two cells that look
 * adjacent must select what is between them on screen — using row index would select an
 * arbitrary scatter of fields in ranked layout, which is worse than useless because it looks
 * plausible.
 */

/** Which modifier was held. Mirrors the platform convention for list selection. */
export interface ClickModifiers {
  /** Extend from the anchor to here. */
  shift: boolean;
  /** Toggle just this one, keeping the rest. ⌘ on macOS, ctrl elsewhere. */
  toggle: boolean;
}

export interface SelectionState {
  /** Row indices currently selected. Empty means nothing is selected. */
  readonly selected: ReadonlySet<number>;
  /** Where a shift-range extends FROM; the last plainly-clicked or toggled cell. */
  readonly anchor: number | null;
}

export const EMPTY_SELECTION: SelectionState = { selected: new Set(), anchor: null };

/**
 * Fold a click into the selection.
 *
 * @param state  current selection
 * @param order  row indices in the order they appear on screen
 * @param clicked the row index that was clicked
 */
export function applyClick(
  state: SelectionState,
  order: readonly number[],
  clicked: number,
  modifiers: ClickModifiers,
): SelectionState {
  // Shift with no anchor behaves like a plain click: there is nothing to extend from, and
  // guessing (say, from the first cell) would select a swathe the user never indicated.
  if (modifiers.shift && state.anchor != null) {
    const from = order.indexOf(state.anchor);
    const to = order.indexOf(clicked);
    if (from === -1 || to === -1) return { selected: new Set([clicked]), anchor: clicked };
    const [lo, hi] = from <= to ? [from, to] : [to, from];
    // Replaces rather than unions: a plain shift-click means "this range", and accumulating
    // would make it impossible to shrink a range without clearing first. Hold toggle as well
    // to add a range to what is already selected.
    const range = order.slice(lo, hi + 1);
    const selected = modifiers.toggle ? new Set([...state.selected, ...range]) : new Set(range);
    // The anchor stays put, so dragging the far end of a range keeps working.
    return { selected, anchor: state.anchor };
  }

  if (modifiers.toggle) {
    const selected = new Set(state.selected);
    if (selected.has(clicked)) {
      selected.delete(clicked);
      // Deselecting the anchor leaves the range origin dangling; move it to the click so the
      // next shift-click extends from somewhere the user just touched.
      return { selected, anchor: clicked };
    }
    selected.add(clicked);
    return { selected, anchor: clicked };
  }

  return { selected: new Set([clicked]), anchor: clicked };
}

/**
 * Fold a click on a WHOLE GROUP into the selection — a well in the tree rail, where one
 * gesture means all of its fields.
 *
 * Deliberately here rather than in the rail, and deliberately not "replace the selection with
 * these row indices". The rail is a second way to drive the SAME selection, so it has to
 * respect the same invariants: the anchor is in visual order, and modifiers mean what they mean
 * everywhere else. Bypassing this and setting `{ selected, anchor: rows.at(-1) }` directly is
 * how the anchor ends up on an arbitrary field and the next shift-click extends from somewhere
 * the user never touched.
 *
 * @param group row indices in the group, in any order; ordering comes from `order`
 */
export function applyGroupClick(
  state: SelectionState,
  order: readonly number[],
  group: readonly number[],
  modifiers: ClickModifiers,
): SelectionState {
  const members = order.filter((id) => group.includes(id));
  if (members.length === 0) return state;
  // The group's first field on screen: a shift-click after picking a well should extend from
  // the top of that well, which is where the eye is.
  const first = members[0];
  const last = members[members.length - 1];

  if (modifiers.shift && state.anchor != null) {
    const from = order.indexOf(state.anchor);
    if (from !== -1) {
      // Spans the anchor AND the whole group. Extending only to the group's nearer end would
      // shift-select part of a well and silently leave the rest out, which looks like the
      // gesture half-failed.
      const lo = Math.min(from, order.indexOf(first));
      const hi = Math.max(from, order.indexOf(last));
      const range = order.slice(lo, hi + 1);
      return {
        selected: modifiers.toggle ? new Set([...state.selected, ...range]) : new Set(range),
        anchor: state.anchor,
      };
    }
  }

  if (modifiers.toggle) {
    // An already-fully-selected group toggles OFF, matching how toggling one cell behaves.
    const allSelected = members.every((id) => state.selected.has(id));
    const selected = new Set(state.selected);
    for (const id of members) {
      if (allSelected) selected.delete(id);
      else selected.add(id);
    }
    return { selected, anchor: first };
  }

  return { selected: new Set(members), anchor: first };
}

/**
 * Which rows a label action should apply to.
 *
 * Acting on a cell inside the selection labels the whole selection — that is the point of
 * selecting. Acting on a cell outside it labels only that cell, rather than silently
 * relabelling a selection the user has visually moved on from.
 */
export function labelTargets(state: SelectionState, clicked: number): number[] {
  return state.selected.has(clicked) && state.selected.size > 1 ? [...state.selected] : [clicked];
}

/** Drop rows that no longer exist, e.g. after the dataset changes underneath. */
export function pruneSelection(state: SelectionState, valid: ReadonlySet<number>): SelectionState {
  const selected = new Set([...state.selected].filter((id) => valid.has(id)));
  if (selected.size === state.selected.size) return state;
  return { selected, anchor: state.anchor != null && valid.has(state.anchor) ? state.anchor : null };
}
