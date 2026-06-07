/**
 * HighlightBus (PLUGIN-ARCHITECTURE §6.7) — the single source of truth for the
 * highlighted row id. A broadcast, idempotent, last-write-wins bus — NOT a graph
 * edge (acyclicity §6.8 only concerns the selection/predicate/rowset edges).
 *
 * `DashboardProvider` mirrors `store` into `DashboardState.highlightId`, so the
 * many non-plugin readers (scatter, gallery, crop viewer, PiP) keep reading core
 * state unchanged; plugins read it reactively via `useHighlight()` and write via
 * `host.highlight.set` — neither reaching into `useDashboard` for it.
 */

import { Store } from "@tanstack/store";

export interface HighlightBus {
  /** Subscribe via this store (e.g. `useSelector`) for reactive reads. */
  readonly store: Store<string | null>;
  get(): string | null;
  set(id: string | null): void;
}

export function createHighlightBus(): HighlightBus {
  const store = new Store<string | null>(null);
  return {
    store,
    get() {
      return store.state;
    },
    set(id) {
      store.setState(() => id);
    },
  };
}

/** Process-wide highlight bus — one highlighted row id across all views. */
export const highlightBus: HighlightBus = createHighlightBus();
