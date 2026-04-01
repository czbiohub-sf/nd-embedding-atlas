/**
 * @deprecated Use ActiveFilterStore instead.
 *
 * BrushPredicateStore is retained only because ScatterContent.tsx still calls
 * setBrushPredicate for the continuous range filter (colormap range slider).
 * It has no subscribers in DashboardProvider and does not drive brushSelection.
 * Do not add new writers or subscribers here.
 *
 * ---
 * Original purpose: TanStack Store bridge between Mosaic brushSelection and React.
 *
 * Problem: calling brushSelection.update() directly from React useEffect races with
 * Mosaic's AsyncDispatch event queue (Param.cancel('value') clears queued updates
 * when consecutive null-predicate calls hit distinct([], []) = false).
 *
 * Solution replaced by ActiveFilterStore + DashboardProvider bridge.
 */
import { Store } from "@tanstack/store";

export interface BrushPredicateState {
  /** Current SQL predicate string, or null for "no filter" */
  predicate: string | null;
  /** Stable source object for Mosaic's cross-filter source tracking */
  source: object;
  /** Monotonically increasing; use as TanStack Query cache key dep */
  version: number;
}

// Module singleton — never changes reference, accessible everywhere
export const brushPredicateStore = new Store<BrushPredicateState>({
  predicate: null,
  source: {},
  version: 0,
});

/** Write a new selection predicate; increments version for cache invalidation. */
export function setBrushPredicate(source: object, sql: string | null) {
  brushPredicateStore.setState((s) => ({
    source,
    predicate: sql,
    version: s.version + 1,
  }));
}

/** Clear the brush selection (show all rows). */
export function clearBrushPredicate(source: object) {
  setBrushPredicate(source, null);
}
