/**
 * Spy host: a `NodeHost` test double for the cross-view routing conformance
 * suite (`host-routing.test.ts`). Records every cross-view call so a test can
 * assert a body's routing module drives the host seam (and only the host seam).
 *
 * It implements just the cross-view surface a routing module touches
 * (`focus`, `filter`, `viewCoordination`, `ordering`); the rest of
 * `NodeHost` is left unimplemented and the whole is cast: routing modules
 * never reach for it. Bus *un*reachability is enforced statically by the
 * boundary lint (plan U6), not here: a spy can't intercept a module import, so
 * the static rule and this behavioral check are complementary, not redundant.
 */

import { Selection } from "@uwdata/mosaic-core";
import type { NodeHost, RowIndex } from "@ndea/sdk";

export interface SpyHostCalls {
  focusSet: (RowIndex | null)[];
  publishFilter: { facet: string; sql: string | null }[];
  viewSyncBroadcast: { panX: number; panY: number; zoom: number }[];
  viewSyncToggleLock: number;
  orderingSet: ({ col: string; dir: "asc" | "desc" } | null)[];
}

type SpyNodeHost = Pick<NodeHost<unknown, "focus-coordination">, "focus"> &
  Pick<NodeHost<unknown, "filter-coordination">, "filter"> &
  Pick<NodeHost<unknown, "data-read" | "row-set-publish">, "dataAPI"> &
  Pick<NodeHost<unknown, "view-coordination">, "viewCoordination"> &
  Pick<NodeHost<unknown, "ordering-coordination">, "ordering">;

export interface SpyHost {
  host: SpyNodeHost;
  calls: SpyHostCalls;
}

/** Build a fresh spy host + its call log. */
export function createSpyHost(): SpyHost {
  const calls: SpyHostCalls = {
    focusSet: [],
    publishFilter: [],
    viewSyncBroadcast: [],
    viewSyncToggleLock: 0,
    orderingSet: [],
  };

  let focus: RowIndex | null = null;
  const focusSubscribers = new Set<(value: RowIndex | null) => void>();
  let viewLinked = false; // toggleLock flips it so broadcastView's gate can be exercised
  let ordering: { col: string; dir: "asc" | "desc" } | null = null;

  const host = {
    focus: {
      get: () => focus,
      set: (rowIndex: RowIndex | null) => {
        focus = rowIndex;
        calls.focusSet.push(rowIndex);
        for (const subscriber of focusSubscribers) subscriber(rowIndex);
      },
      subscribe: (subscriber: (value: RowIndex | null) => void) => {
        focusSubscribers.add(subscriber);
        return () => focusSubscribers.delete(subscriber);
      },
    },
    filter: {
      selection: Selection.crossfilter(),
      getResolved: () => ({ predicate: null, revision: 0 }),
      subscribeResolved: () => () => {},
      publish: (facet: string, sql: string) => {
        calls.publishFilter.push({ facet, sql });
      },
      clear: (facet: string) => {
        calls.publishFilter.push({ facet, sql: null });
      },
      associateClient() {},
      disassociateClient() {},
      materializeRowIds: async () => ({ rowIds: [], revision: 0 }),
    },
    dataAPI: {
      query: () => Promise.resolve([]),
      publishRowSet: async (rowIds: RowIndex[]) => ({
        predicate: "",
        token: 0,
        count: rowIds.length,
        table: "",
      }),
      // Temporary large-selection staging cleanup.
      disposePublishedRowSet: () => Promise.resolve(),
    },
    viewCoordination: {
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
  } satisfies SpyNodeHost;

  return { host, calls };
}
