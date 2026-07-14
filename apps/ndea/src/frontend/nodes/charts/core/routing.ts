/**
 * Charts cross-view routing (Humble Object) — the testable seam the conformance
 * suite (`core/node/host-routing.test.ts`) exercises. A chart's bar-click /
 * brush emits its filter on the node's selection-out push port.
 *
 * The Workspace runtime maps the `"lasso"` facet to the node's `sel` output
 * wire. Here that historical facet name means “selection output,” not a lasso
 * gesture. Other facets stay in the session predicate bus.
 */

import type { NodeHost } from "@ndea/sdk";

type PredicatePublishingHost = Pick<NodeHost<unknown, "predicate-publish">, "publishPredicate">;

/** Workspace runtime's edge-bound selection-output facet (see file header). */
const SELECTION_FACET = "lasso";

/** Publish this chart's filter on its selection-out push port; null clears it. */
export function publishChartFilter(host: PredicatePublishingHost, sql: string | null): void {
  host.publishPredicate(SELECTION_FACET, sql);
}
