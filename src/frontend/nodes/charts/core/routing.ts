/**
 * Charts cross-view routing (Humble Object) — the testable seam the conformance
 * suite (`core/node/host-routing.test.ts`) exercises. A chart's bar-click /
 * brush emits its filter on the node's selection-out push port.
 *
 * body-dock edge-binds ONLY the `"lasso"` facet (→ `ws.emitLasso` → the node's
 * `sel` out wire); every other facet falls through to the dashboard-global bus,
 * inert on the canvas. So a chart rides the same push port scatter's lasso does
 * — `"lasso"` here is body-dock's label for "this node's selection-out", not a
 * lasso gesture. ponytail: reuse the one wired path; a dedicated chart facet
 * would need a body-dock change for zero behavioral gain.
 */

import type { NodeHost } from "@/core/node/host";

/** body-dock's edge-bound selection-out push port (see file header). */
const SELECTION_FACET = "lasso";

/** Publish this chart's filter on its selection-out push port; null clears it. */
export function publishChartFilter(host: NodeHost, sql: string | null): void {
  host.publishPredicate(SELECTION_FACET, sql);
}
