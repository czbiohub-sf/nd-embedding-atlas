import { Store } from "@tanstack/store";
import type { PanelId } from "../lib/branded-types";

/**
 * ActiveFilterStore — composed source of truth for the Mosaic brushSelection.
 *
 * Two orthogonal facets compose via AND:
 *   - `lassoPredicate`     — drawn by the user on the scatter canvas
 *   - `activeSetPredicate` — server-built predicate for the active collection
 *
 * They are independent: a user can lasso while a collection is active and
 * the predicate becomes `(active_set) AND (lasso)`. Activating a new
 * collection does NOT touch lasso state (the bridge clears the lasso
 * separately when a collection is activated, by design).
 *
 * Components write via the typed setters below. DashboardProvider is the
 * SOLE subscriber that calls brushSelection.update() — via the
 * requestAnimationFrame bridge.
 */

export interface ActiveFilterState {
  /** Lasso predicate, or null when no lasso is drawn. */
  lassoPredicate: string | null;
  /** Active-set predicate, or null when no collection is active. */
  activeSetPredicate: string | null;
  /** Stable source object for Mosaic cross-filter source tracking. */
  source: object;
  /** Panel that originated the lasso (null for the active-set source). */
  sourcePanelId: PanelId | null;
  /** Monotonically increasing — use as dep for TanStack Query cache keys. */
  version: number;
}

const stableSource = {};

export const activeFilterStore = new Store<ActiveFilterState>({
  lassoPredicate: null,
  activeSetPredicate: null,
  source: stableSource,
  sourcePanelId: null,
  version: 0,
});

/**
 * Compose the two facets into a single SQL predicate Mosaic can consume.
 * Returns null when both are null. Wraps each facet in parens so AND
 * binds correctly across complex expressions.
 */
export function composedPredicate(s: ActiveFilterState): string | null {
  if (s.lassoPredicate && s.activeSetPredicate) {
    return `(${s.activeSetPredicate}) AND (${s.lassoPredicate})`;
  }
  return s.lassoPredicate ?? s.activeSetPredicate;
}

export function setLassoFilter(panelId: PanelId, predicate: string | null): void {
  activeFilterStore.setState((s) => ({
    ...s,
    lassoPredicate: predicate,
    source: stableSource,
    sourcePanelId: panelId,
    version: s.version + 1,
  }));
}

export function clearLassoFilter(panelId: PanelId): void {
  setLassoFilter(panelId, null);
}

export function setActiveSetFilter(predicate: string): void {
  activeFilterStore.setState((s) => ({
    ...s,
    activeSetPredicate: predicate,
    source: stableSource,
    version: s.version + 1,
  }));
}

export function clearActiveSetFilter(): void {
  activeFilterStore.setState((s) => ({
    ...s,
    activeSetPredicate: null,
    version: s.version + 1,
  }));
}
