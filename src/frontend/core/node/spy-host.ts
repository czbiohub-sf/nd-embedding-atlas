/**
 * Spy host — a `NodeHost` test double for the cross-view routing conformance
 * suite (`host-routing.test.ts`). Records every cross-view call so a test can
 * assert a body's routing module drives the host seam (and only the host seam).
 *
 * It implements just the cross-view surface a routing module touches
 * (`highlight`, `inputSelection`, `publishPredicate`, `publishRowSet`,
 * `clearRowSet`, `externalRowSet`/`onExternalRowSet`, `viewSync`); the rest of
 * `NodeHost` is left unimplemented and the whole is cast — routing modules
 * never reach for it. Bus *un*reachability is enforced statically by the
 * boundary lint (plan U6), not here: a spy can't intercept a module import, so
 * the static rule and this behavioral check are complementary, not redundant.
 */

import type { NodeHost } from "./host";

export interface SpyHostCalls {
  highlightSet: (string | null)[];
  publishPredicate: { facet: string; sql: string | null }[];
  publishRowSet: number[][];
  clearRowSet: number;
  viewSyncBroadcast: { panX: number; panY: number; zoom: number }[];
  viewSyncToggleLock: number;
  orderingSet: ({ col: string; dir: "asc" | "desc" } | null)[];
}

export interface SpyHost {
  host: NodeHost;
  calls: SpyHostCalls;
}

/** Build a fresh spy host + its call log. */
export function createSpyHost(): SpyHost {
  const calls: SpyHostCalls = {
    highlightSet: [],
    publishPredicate: [],
    publishRowSet: [],
    clearRowSet: 0,
    viewSyncBroadcast: [],
    viewSyncToggleLock: 0,
    orderingSet: [],
  };

  let focus: string | null = null;
  let viewLinked = false; // toggleLock flips it so broadcastView's gate can be exercised
  let ordering: { col: string; dir: "asc" | "desc" } | null = null;

  const host = {
    highlight: {
      get: () => focus,
      set: (id: string | null) => {
        focus = id;
        calls.highlightSet.push(id);
      },
      subscribe: () => () => {},
    },
    publishPredicate: (facet: string, sql: string | null) => {
      calls.publishPredicate.push({ facet, sql });
    },
    publishRowSet: (ids: number[]) => {
      calls.publishRowSet.push(ids);
    },
    clearRowSet: () => {
      calls.clearRowSet += 1;
    },
    externalRowSet: () => null,
    onExternalRowSet: () => () => {},
    api: {
      // selection-out capability surface a routing module may touch on clear.
      disposeSelection: () => {},
    },
    viewSync: {
      panX: 0,
      panY: 0,
      zoom: 1,
      get linked() {
        return viewLinked;
      },
      broadcast: (state: { panX: number; panY: number; zoom: number }) => {
        calls.viewSyncBroadcast.push(state);
      },
      toggleLock: () => {
        viewLinked = !viewLinked;
        calls.viewSyncToggleLock += 1;
      },
      subscribe: () => () => {},
    },
    ordering: {
      get: () => ordering,
      set: (v: { col: string; dir: "asc" | "desc" } | null) => {
        ordering = v;
        calls.orderingSet.push(v);
      },
      subscribe: () => () => {},
    },
  } as unknown as NodeHost;

  return { host, calls };
}
