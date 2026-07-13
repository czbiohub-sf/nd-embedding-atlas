/**
 * Cross-view routing conformance (host-seam plan, U1/U2) — the behavioral
 * backstop that keeps every node's focus/selection/view-sync gestures flowing
 * through the per-instance `host` seam, never the global dashboard/bus channel.
 *
 * Two guards:
 *   1. Coverage gate — every view-kind node must DECLARE how it routes cross-view
 *      gestures: a routing-module entry (exercised below) or an explicit
 *      exemption with a reason. A new view node with no entry fails here, forcing
 *      a conscious host-vs-bus decision at add time (scales to new nodes).
 *   2. Routing checks — each routing module, invoked with a spy host, drives the
 *      expected host method. Bus *un*reachability is the boundary lint's job
 *      (plan U6) — a spy can't intercept imports; the two guards are complementary.
 */

import { describe, expect, test } from "bun:test";

import { publishChartFilter } from "@/nodes/charts/core/routing";
import { focusObs } from "@/nodes/gallery/routing";
import {
  broadcastView,
  clearLasso,
  focusPoint,
  publishLasso,
  publishLassoRowSet,
  publishRangeFilter,
  toggleViewLock,
} from "@/nodes/scatter/routing";
import { focusRow, publishOrdering } from "@/nodes/table/routing";
import { listWorkspaceNodeSpecs } from "@/core/workspace/definitions";
import { createSpyHost } from "./spy-host";

// Every view-kind node must appear here — "routed" (a routing module exercised
// below) or { exempt } with a reason. Adding a view node without an entry fails
// the coverage gate, forcing the host-vs-bus decision when the node is born.
const ROUTING_COVERAGE: Record<string, "routed" | { exempt: string }> = {
  table: "routed",
  gallery: "routed",
  scatter: "routed",
  "count-plot": "routed",
  histogram: "routed",
  fov: { exempt: "focus consumer — no cross-view write gesture" },
  count: { exempt: "display-only — no cross-view gesture" },
  annotate: { exempt: "focus emitter via cursor effect, not a discrete gesture handler" },
};

describe("cross-view routing conformance", () => {
  test("every view-kind node declares its cross-view routing", () => {
    const viewTypes = listWorkspaceNodeSpecs()
      .filter((s) => s.kind === "view")
      .map((s) => s.type);
    for (const type of viewTypes) {
      expect(
        ROUTING_COVERAGE[type],
        `view node "${type}" has no cross-view routing declaration — add a routing module entry or an explicit exemption in ROUTING_COVERAGE`,
      ).toBeDefined();
    }
  });

  test("gallery crop-click routes focus through the host seam", () => {
    const { host, calls } = createSpyHost();
    focusObs(host, "4821");
    expect(calls.highlightSet).toEqual(["4821"]);
  });

  test("table row-click routes focus through the host seam", () => {
    const { host, calls } = createSpyHost();
    focusRow(host, "17");
    expect(calls.highlightSet).toEqual(["17"]);
  });

  test("table sort routes through the host seam's ordering facet", () => {
    const { host, calls } = createSpyHost();
    publishOrdering(host, { col: "area", dir: "desc" });
    publishOrdering(host, null); // clear sort
    expect(calls.orderingSet).toEqual([{ col: "area", dir: "desc" }, null]);
  });

  test("scatter gestures route through the host seam", () => {
    const { host, calls } = createSpyHost();
    focusPoint(host, "5"); // point click
    focusPoint(host, null); // background / escape clear
    publishRangeFilter(host, "x > 1"); // continuous-range filter
    publishLasso(host, "__row_index__ IN (1,2,3)"); // lasso facet
    publishLassoRowSet(host, [1, 2, 3]); // GPU dim-mask
    clearLasso(host); // lasso clear

    expect(calls.highlightSet).toEqual(["5", null]);
    expect(calls.publishPredicate).toEqual([
      { facet: "range", sql: "x > 1" },
      { facet: "lasso", sql: "__row_index__ IN (1,2,3)" },
      { facet: "lasso", sql: null }, // clearLasso drops the facet
    ]);
    expect(calls.publishRowSet).toEqual([[1, 2, 3]]);
    expect(calls.clearRowSet).toBe(1); // clearLasso true-clears
  });

  test("scatter view-sync routes through the host seam (broadcast + toggleLock)", () => {
    const { host, calls } = createSpyHost();
    broadcastView(host, { panX: 1, panY: 2, zoom: 3 }); // unlinked → gated, no broadcast
    expect(calls.viewSyncBroadcast).toEqual([]);
    toggleViewLock(host); // → linked, via the facet
    broadcastView(host, { panX: 4, panY: 5, zoom: 6 }); // now broadcasts
    expect(calls.viewSyncToggleLock).toBe(1);
    expect(calls.viewSyncBroadcast).toEqual([{ panX: 4, panY: 5, zoom: 6 }]);
  });

  test("chart filter routes through the host seam's selection-out push port", () => {
    const { host, calls } = createSpyHost();
    publishChartFilter(host, "col = 'A'"); // bar click / brush
    publishChartFilter(host, null); // clear
    // count-plot + histogram both emit via this one routing module; body-dock
    // edge-binds the "lasso" facet to the node's sel out wire.
    expect(calls.publishPredicate).toEqual([
      { facet: "lasso", sql: "col = 'A'" },
      { facet: "lasso", sql: null },
    ]);
  });
});
