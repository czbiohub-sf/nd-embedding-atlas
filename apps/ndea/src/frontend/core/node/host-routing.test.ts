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
import { rowIndex, type NodeHost, type RowIndex } from "@ndea/sdk";

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
import { GraphEngine } from "@/core/graph/engine";
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
    focusObs(host, rowIndex(4821));
    expect(calls.focusSet).toEqual([rowIndex(4821)]);
  });

  test("table row-click routes focus through the host seam", () => {
    const { host, calls } = createSpyHost();
    focusRow(host, rowIndex(17));
    expect(calls.focusSet).toEqual([rowIndex(17)]);
  });

  test("table focus reaches a viewer for first, replacement, and clear until its focus wire is deleted", () => {
    const engine = new GraphEngine<RowIndex | null>({ schedule: (flush) => flush() });
    engine.addNode({ id: "table", kind: "view", cook: () => null });
    engine.addNode({
      id: "viewer",
      kind: "view",
      cook: (inputs) => inputs.get("highlight-in")?.at(-1) ?? null,
    });
    engine.connect({ from: "table", fromPort: "out", to: "viewer", toPort: "highlight-in" });

    const viewerFocus: (RowIndex | null)[] = [];
    engine.registerSink("viewer", (value) => viewerFocus.push(value));
    const host = {
      focus: {
        get: () => null,
        set: (value: RowIndex | null) => engine.emit("table", "out", value),
      },
    } as NodeHost<unknown, "focus-coordination">;

    expect(viewerFocus).toEqual([null]);
    focusRow(host, rowIndex(17));
    focusRow(host, rowIndex(42));
    focusRow(host, null);
    focusRow(host, rowIndex(7));

    expect(viewerFocus).toEqual([null, rowIndex(17), rowIndex(42), null, rowIndex(7)]);

    engine.disconnect({ from: "table", fromPort: "out", to: "viewer", toPort: "highlight-in" });
    expect(viewerFocus.at(-1)).toBeNull();
    focusRow(host, rowIndex(99));
    expect(viewerFocus).toEqual([null, rowIndex(17), rowIndex(42), null, rowIndex(7), null]);
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
    publishRangeFilter(host, "x > 1"); // continuous-range filter
    publishLasso(host, "__row_index__ IN (1,2,3)"); // lasso facet
    publishLassoRowSet(host, [rowIndex(1), rowIndex(2), rowIndex(3)]); // GPU dim-mask
    clearLasso(host); // lasso clear

    expect(calls.focusSet).toEqual([rowIndex(5), null]);
    expect(calls.publishPredicate).toEqual([
      { facet: "range", sql: "x > 1" },
      { facet: "lasso", sql: "__row_index__ IN (1,2,3)" },
      { facet: "lasso", sql: null }, // clearLasso drops the facet
    ]);
    expect(calls.publishRowSet).toEqual([[rowIndex(1), rowIndex(2), rowIndex(3)]]);
    expect(calls.clearRowSet).toBe(1); // clearLasso true-clears
  });

  test("focus, row-set, and graph predicate routes remain independent", () => {
    const { host, calls } = createSpyHost();
    focusPoint(host, rowIndex(8));
    publishLassoRowSet(host, [rowIndex(2), rowIndex(5)]);
    publishLasso(host, "__row_index__ IN (2,5)");

    expect(host.focus.get()).toBe(rowIndex(8));
    expect(calls.focusSet).toEqual([rowIndex(8)]);
    expect(calls.publishRowSet).toEqual([[rowIndex(2), rowIndex(5)]]);
    expect(calls.publishPredicate).toEqual([{ facet: "lasso", sql: "__row_index__ IN (2,5)" }]);
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
