/**
 * Scatter cross-view routing (Humble Object): the testable seam the conformance
 * suite (`core/node/host-routing.test.ts`) exercises. Each scatter gesture's
 * *host-side* write lives here as a plain function, so "which host channel does
 * this gesture drive" is centralized + verifiable without a live WebGPU canvas.
 *
 * Throttle/debounce orchestration stays at call sites; cross-view writes use
 * only capability-gated host services.
 */

import type { NodeHost, RowIndex } from "@ndea/sdk";

type ScatterFocusHost = Pick<NodeHost<unknown, "focus-coordination">, "focus">;
type ScatterFilterHost = Pick<NodeHost<unknown, "filter-coordination">, "filter">;
type ScatterRowSetStagingHost = Pick<NodeHost<unknown, "data-read" | "row-set-publish">, "dataAPI">;
type ScatterViewHost = Pick<NodeHost<unknown, "view-coordination">, "viewCoordination">;
/** Point/background click → focus the obs (or clear). Sync-group-aware host seam. */
export function focusPoint(host: ScatterFocusHost, focusedRowIndex: RowIndex | null): void {
  host.focus.set(focusedRowIndex);
}

/** Continuous-range filter → the instance's "range" predicate facet. */
export function publishRangeFilter(host: ScatterFilterHost, sql: string | null): void {
  if (sql === null) host.filter.clear("range");
  else host.filter.publish("range", sql);
}

/** Lasso → the instance's "lasso" predicate facet. */
export function publishLasso(host: ScatterFilterHost, predicate: string | null, rowIds?: readonly RowIndex[]): void {
  if (predicate === null) host.filter.clear("lasso");
  else host.filter.publish("lasso", predicate, rowIds);
}

/** Legend isolation → the instance's "isolation" predicate facet. */
export function publishIsolationFilter(host: ScatterFilterHost, sql: string | null): void {
  if (sql === null) host.filter.clear("isolation");
  else host.filter.publish("isolation", sql);
}

/** Stage a large lasso without broadcasting it on the obsolete row-set bus. */
export async function stageLassoRowSet(host: ScatterRowSetStagingHost, rowIds: readonly RowIndex[]): Promise<string> {
  return (await host.dataAPI.publishRowSet([...rowIds])).predicate;
}

/** Dispose only the temporary staging table, preserving the active facet. */
export function disposeStagedLasso(host: ScatterRowSetStagingHost): Promise<void> {
  return host.dataAPI.disposePublishedRowSet();
}

/** Clear the lasso facet and any temporary table used to stage a large selection. */
export function clearLasso(host: ScatterFilterHost & ScatterRowSetStagingHost): Promise<void> {
  host.filter.clear("lasso");
  return disposeStagedLasso(host);
}

/** Pan/zoom → broadcast on the instance's view-sync scope (no-op when unlinked).
 *  Cross-panel pan/zoom sharing flows through the host seam, never the
 *  process-wide ViewSyncStore directly. */
export function broadcastView(host: ScatterViewHost, state: { panX: number; panY: number; zoom: number }): void {
  if (host.viewCoordination.linked) host.viewCoordination.broadcast(state);
}

/** Toggle this instance's view-sync lock (assign/clear its view-sync scope). */
export function toggleViewLock(host: ScatterViewHost): void {
  host.viewCoordination.toggleLock();
}
