import { Store } from "@tanstack/store";
import type { ObsSetId, PanelId } from "../lib/branded-types";

/**
 * ActiveFilterStore — single source of truth for the Mosaic brushSelection predicate.
 *
 * Components write here (via setActiveFilter / setObsSetFilter). DashboardProvider is the
 * SOLE subscriber that calls brushSelection.update() — via the existing
 * requestAnimationFrame bridge in DashboardProvider.
 *
 * filterSource discriminates the origin of the current predicate:
 *   "lasso"  — drawn by the user on the scatter canvas
 *   "obsset" — activated from the ObsSet panel
 *   null     — no active filter
 *
 * The two-tier timing in useScatterBrushSync (50ms throttle / 200ms debounce)
 * is PRESERVED — it gates writes to this store, not brushSelection.update() calls.
 */

export type FilterSource = "lasso" | "obsset" | null;

export interface ActiveFilterState {
  /** SQL WHERE fragment, or null for "no filter" */
  predicate: string | null;
  /** Stable source object for Mosaic cross-filter source tracking (one per session) */
  source: object;
  /** Panel that originated this filter (null for obsset filters) */
  sourcePanelId: PanelId | null;
  /** Discriminates lasso vs obsset vs no filter */
  filterSource: FilterSource;
  /** Monotonically increasing — use as dep for TanStack Query cache keys */
  version: number;
}

const stableSource = {};

export const activeFilterStore = new Store<ActiveFilterState>({
  predicate: null,
  source: stableSource,
  sourcePanelId: null,
  filterSource: null,
  version: 0,
});

export function setActiveFilter(panelId: PanelId, predicate: string | null): void {
  activeFilterStore.setState((s) => ({
    ...s,
    predicate,
    source: stableSource,
    sourcePanelId: panelId,
    filterSource: "lasso",
    version: s.version + 1,
  }));
}

export function clearActiveFilter(panelId: PanelId): void {
  setActiveFilter(panelId, null);
}

export function setObsSetFilter(_obsSetId: ObsSetId, predicate: string): void {
  activeFilterStore.setState((s) => ({
    ...s,
    predicate,
    source: stableSource,
    sourcePanelId: null,
    filterSource: "obsset",
    version: s.version + 1,
  }));
}

export function clearObsSetFilter(): void {
  activeFilterStore.setState((s) => ({
    ...s,
    predicate: null,
    filterSource: null,
    version: s.version + 1,
  }));
}
