/**
 * BrushPredicateStore — TanStack Store bridge between Mosaic brushSelection and React.
 *
 * Problem: calling brushSelection.update() directly from React useEffect races with
 * Mosaic's AsyncDispatch event queue (Param.cancel('value') clears queued updates
 * when consecutive null-predicate calls hit distinct([], []) = false).
 *
 * Solution: components write selection intent to this Store. A stable subscription
 * (wired in DashboardProvider, outside React's render cycle) translates Store state
 * → brushSelection.update() via requestAnimationFrame, ensuring no dispatch conflicts.
 *
 * Any component can also READ the current brush predicate without needing Mosaic refs:
 *   const pred = useStore(brushPredicateStore, s => s.predicate);
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
