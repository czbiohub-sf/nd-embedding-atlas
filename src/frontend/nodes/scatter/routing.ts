/**
 * Scatter cross-view routing (Humble Object) — the testable seam the conformance
 * suite (`core/node/host-routing.test.ts`) exercises. Each scatter gesture's
 * *host-side* write lives here as a plain function, so "which host channel does
 * this gesture drive" is centralized + verifiable without a live WebGPU canvas.
 *
 * The throttle/debounce orchestration and the (legacy) global-bus `else` arms
 * stay at the call sites for now; the dual-path collapse removes those arms in a
 * later unit. These functions are the host path only — a body can't route a
 * cross-view write to the global bus *through* them.
 */

import type { NodeHost } from "@/core/node/host";

/** Point/background click → focus the obs (or clear). Sync-group-aware host seam. */
export function focusPoint(host: NodeHost, rowId: string | null): void {
  host.highlight.set(rowId);
}

/** Continuous-range filter → the instance's "range" predicate facet. */
export function publishRangeFilter(host: NodeHost, sql: string | null): void {
  host.publishPredicate("range", sql);
}

/** Lasso → the instance's "lasso" predicate facet. */
export function publishLasso(host: NodeHost, predicate: string | null): void {
  host.publishPredicate("lasso", predicate);
}

/** Lasso row-set → GPU dim-mask broadcast. */
export function publishLassoRowSet(host: NodeHost, rowIds: number[]): void {
  host.publishRowSet(rowIds);
}

/** Clear the lasso: drop the facet, TRUE-clear the row-set, drop the staged sel table. */
export function clearLasso(host: NodeHost): void {
  host.publishPredicate("lasso", null);
  host.clearRowSet(); // true clear — NOT publishRowSet([])
  host.api.disposeSelection?.();
}

/** Pan/zoom → broadcast on the instance's view-sync scope (no-op when unlinked).
 *  Cross-panel pan/zoom sharing flows through the host seam, never the
 *  process-wide ViewSyncStore directly. */
export function broadcastView(host: NodeHost, state: { panX: number; panY: number; zoom: number }): void {
  if (host.viewSync.linked) host.viewSync.broadcast(state);
}

/** Toggle this instance's view-sync lock (assign/clear its view-sync scope). */
export function toggleViewLock(host: NodeHost): void {
  host.viewSync.toggleLock();
}
