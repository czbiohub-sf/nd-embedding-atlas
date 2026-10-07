/**
 * Cross-view routing conformance (host-seam plan, U1/U2): the behavioral
 * backstop that keeps every node's focus/selection/view-sync gestures flowing
 * through the per-instance `host` seam, never a global bus channel.
 *
 * Two guards:
 *   1. Coverage gate: every view-kind node must DECLARE how it routes cross-view
 *      gestures: a routing-module entry (exercised below) or an explicit
 *      exemption with a reason. A new view node with no entry fails here, forcing
 *      a conscious host-vs-bus decision at add time (scales to new nodes).
 *   2. Routing checks: each routing module, invoked with a spy host, drives the
 *      expected host method. Bus *un*reachability is the boundary lint's job
 *      (plan U6): a spy can't intercept imports; the two guards are complementary.
 */

import { describe, expect, test } from "bun:test";
import type { FilterClause } from "@ndea/protocol";
import { rowIndex } from "@ndea/sdk";

import { publishChartFilter } from "@ndea/nodes/charts";
import { focusObs } from "@ndea/nodes/gallery";
import {
  broadcastView,
  clearLasso,
  focusPoint,
  publishLasso,
  publishRangeFilter,
  toggleViewLock,
} from "@ndea/nodes/scatter";
import { focusRow, publishOrdering } from "@ndea/nodes/table";
import { createNativeAppNodeLibrary } from "./library";
import { createSpyHost } from "./spy-host";

const RANGE: FilterClause = { op: "between", column: "x", range: [1, 2] };
const LASSO: FilterClause = { op: "inSet", set: "0123456789abcdef" };
const BAR: FilterClause = { op: "in", column: "col", values: ["A"] };

const nativeNodeLibrary = createNativeAppNodeLibrary();

// Every view-kind node must appear here: "routed" (a routing module exercised
// below) or { exempt } with a reason. Adding a view node without an entry fails
// the coverage gate, forcing the host-vs-bus decision when the node is born.
const ROUTING_COVERAGE: Record<string, "routed" | { exempt: string }> = {
  table: "routed",
  gallery: "routed",
  scatter: "routed",
  "count-plot": "routed",
  histogram: "routed",
  vgplot: "routed",
  "image-viewer": { exempt: "focus consumer: no cross-view write gesture" },
  count: { exempt: "display-only: no cross-view gesture" },
  annotate: { exempt: "focus emitter via cursor effect, not a discrete gesture handler" },
};

describe("cross-view routing conformance", () => {
  test("every view-kind node declares its cross-view routing", () => {
    const viewTypes = nativeNodeLibrary
      .listSpecs()
      .filter((s) => s.role === "view")
      .map((s) => s.definition.ref.nodeTypeId);
    for (const type of viewTypes) {
      expect(
        ROUTING_COVERAGE[type],
        `view node "${type}" has no cross-view routing declaration: add a routing module entry or an explicit exemption in ROUTING_COVERAGE`,
      ).toBeDefined();
    }
  });

  test("gallery crop-click routes focus through the host seam", () => {
    const { host, calls } = createSpyHost();
    focusObs(host, rowIndex(4821));
    expect(calls.focusSet).toEqual([rowIndex(4821)]);
  });

  test("table row-click routes focus through the host seam", () => {
    const { host, calls } = createSpyHost();
    focusRow(host, rowIndex(17));
    expect(calls.focusSet).toEqual([rowIndex(17)]);
  });

  test("table sort routes through the host seam's ordering facet", () => {
    const { host, calls } = createSpyHost();
    publishOrdering(host, { col: "area", dir: "desc" });
    publishOrdering(host, null); // clear sort
    expect(calls.orderingSet).toEqual([{ col: "area", dir: "desc" }, null]);
  });

  test("scatter gestures route through the host seam", () => {
    const { host, calls } = createSpyHost();
    focusPoint(host, rowIndex(5)); // point click
    focusPoint(host, null); // background / escape clear
    publishRangeFilter(host, RANGE); // continuous-range filter
    publishLasso(host, LASSO); // lasso facet
    clearLasso(host); // lasso clear

    expect(calls.focusSet).toEqual([rowIndex(5), null]);
    expect(calls.publishFilter).toEqual([
      { facet: "range", clause: RANGE },
      { facet: "lasso", clause: LASSO },
      { facet: "lasso", clause: null }, // clearLasso drops the facet
    ]);
  });

  test("focus and filter routes remain independent", () => {
    const { host, calls } = createSpyHost();
    focusPoint(host, rowIndex(8));
    publishLasso(host, LASSO);

    expect(host.focus.get()).toBe(rowIndex(8));
    expect(calls.focusSet).toEqual([rowIndex(8)]);
    expect(calls.publishFilter).toEqual([{ facet: "lasso", clause: LASSO }]);
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

  test("chart filter routes through the host filter scope", () => {
    const { host, calls } = createSpyHost();
    publishChartFilter(host, BAR); // bar click / brush
    publishChartFilter(host, null); // clear
    // count-plot, histogram, and vgplot all emit via this one routing module;
    expect(calls.publishFilter).toEqual([
      { facet: "chart", clause: BAR },
      { facet: "chart", clause: null },
    ]);
  });
});
