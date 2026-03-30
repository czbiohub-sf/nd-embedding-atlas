import { Store } from "@tanstack/store";
import type { PanelId } from "../lib/branded-types";

/**
 * ActiveFilterStore — single source of truth for the Mosaic brushSelection predicate.
 *
 * Components write here (via setActiveFilter). DashboardProvider is the
 * SOLE subscriber that calls brushSelection.update() — via the existing
 * requestAnimationFrame bridge in BrushPredicateStore (which this supersedes).
 *
 * The two-tier timing in useScatterBrushSync (50ms throttle / 200ms debounce)
 * is PRESERVED — it gates writes to this store, not brushSelection.update() calls.
 */
export interface ActiveFilterState {
  /** SQL WHERE fragment, or null for "no filter" */
  predicate: string | null;
  /** Stable source object for Mosaic cross-filter source tracking (one per session) */
  source: object;
  /** Panel that originated this filter */
  sourcePanelId: PanelId | null;
  /** Monotonically increasing — use as dep for TanStack Query cache keys */
  version: number;
}

const stableSource = {};

export const activeFilterStore = new Store<ActiveFilterState>({
  predicate: null,
  source: stableSource,
  sourcePanelId: null,
  version: 0,
});

export function setActiveFilter(
  panelId: PanelId,
  predicate: string | null,
): void {
  activeFilterStore.setState((s) => ({
    ...s,
    predicate,
    sourcePanelId: panelId,
    version: s.version + 1,
  }));
}

export function clearActiveFilter(panelId: PanelId): void {
  setActiveFilter(panelId, null);
}
