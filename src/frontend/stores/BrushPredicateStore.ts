/**
 * @deprecated Use ActiveFilterStore instead.
 *
 * BrushPredicateStore is a dead-end: it has no subscribers in DashboardProvider
 * and does not drive brushSelection. It is retained only as the byte-identical
 * sink for the scatter's `range` (colormap range slider) and `isolation`
 * (legend category isolation) facets, which today drive ONLY the GPU dim-mask.
 * The sole writer is now `core/buses/selection-bus.ts` (the `range`/`isolation`
 * facets) — do not add other writers or subscribers. This store is retired in
 * Phase 4 when those facets are promoted to a real per-instance cross-filter
 * clause source (PLUGIN-ARCHITECTURE §6.3).
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
