/**
 * Cache node — live-until-cached checkpoint semantics.
 *
 * Exercises the source-agnostic Cache node directly against a Workspace:
 *   - live (uncached) passes its input through (R2)
 *   - Cache pins the current rows by value; downstream is fixed (R3, R6)
 *   - the live input moving past the pin is detectable as stale (R5)
 *   - Recache re-pins (R4); go-live drops the pin
 *   - the scatter freeze affordance mints a Cache node, not a Selection node (R7)
 *
 * Reads are synchronous via engine.pull — no flush/rAF needed.
 */

import { describe, expect, test } from "bun:test";
import { rowIndex } from "@ndea/sdk";

import { predicateSql } from "@/core/graph/cook";
import { nativeWorkspaceNodeLibrary } from "./definitions";
import { Workspace } from "./workspace-store";
import type { Metadata } from "@ndea/protocol";

// rAF doesn't exist under bun:test — the Workspace ctor references it for the
// flush scheduler. We only pull synchronously, so a no-op stub is enough.
(globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame ??= (() => 0) as unknown;

// Register the built-in node specs so cooks drive through the spec path
function makeWs() {
  return new Workspace({
    coordinator: { query: () => Promise.resolve([]) } as never,
    table: "atlas",
    metadata: { dataset_keys: [] } as unknown as Metadata,
    nodeLibrary: nativeWorkspaceNodeLibrary,
  });
}

const cookSql = (ws: Workspace, id: string) => predicateSql(ws.pullGraphNode(id));

describe("Cache node", () => {
  test("live (uncached) passes a pred input through; pin fixes it (R2, R3, R6)", () => {
    const ws = makeWs();
    const obs = ws.addNode("obs", { x: 0, y: 0 }, "obs");
    const wr = ws.addNode("wrangle", { x: 100, y: 0 });
    const cache = ws.addNode("cache", { x: 200, y: 0 });
    ws.connect(obs, wr);
    ws.connect(wr, cache);

    // upstream emits a predicate (wrangle compiled pred)
    ws.setWranglePred(wr, "x > 1");
    expect(cookSql(ws, cache)).toBe("x > 1"); // live: follows input
    expect(ws.isCached(cache)).toBe(false);

    // pin the current rows
    expect(ws.pinCache(cache)).toBe(true);
    expect(ws.isCached(cache)).toBe(true);
    expect(cookSql(ws, cache)).toBe("x > 1");

    // upstream moves — cached output stays fixed (R3)
    ws.setWranglePred(wr, "x > 999");
    expect(cookSql(ws, cache)).toBe("x > 1");

    // go live again — follows the (new) input
    ws.uncache(cache);
    expect(ws.isCached(cache)).toBe(false);
    expect(cookSql(ws, cache)).toBe("x > 999");
  });

  test("staleness: cached + upstream advanced past the pin epoch (R5)", () => {
    const ws = makeWs();
    const obs = ws.addNode("obs", { x: 0, y: 0 }, "obs");
    const wr = ws.addNode("wrangle", { x: 100, y: 0 });
    const cache = ws.addNode("cache", { x: 200, y: 0 });
    ws.connect(obs, wr);
    ws.connect(wr, cache);

    ws.setWranglePred(wr, "x > 1");
    ws.pinCache(cache);
    const stamp = ws.store.state.nodes[cache].stamp!;
    expect(stamp).toBeGreaterThanOrEqual(0);

    // upstream re-cooks → epoch advances past the pin → recache available
    ws.setWranglePred(wr, "x > 2");
    expect(ws.graphEpoch).toBeGreaterThan(stamp);

    // Recache re-pins to the new live input (R4) and refreshes the stamp
    expect(ws.pinCache(cache)).toBe(true);
    expect(cookSql(ws, cache)).toBe("x > 2");
    expect(ws.store.state.nodes[cache].stamp!).toBeGreaterThan(stamp);
  });

  test("source-agnostic: accepts a scatter lasso (sel) input by value", () => {
    const ws = makeWs();
    const obs = ws.addNode("obs", { x: 0, y: 0 }, "obs");
    const sc = ws.addNode("scatter", { x: 100, y: 0 });
    const cache = ws.addNode("cache", { x: 200, y: 0 });
    ws.connect(obs, sc);
    ws.connect(sc, cache); // sel push wire

    ws.emitLasso(sc, "__row_index__ IN (1, 2, 3)", [rowIndex(1), rowIndex(2), rowIndex(3)]);
    // live: the pushed sel takes over
    expect(cookSql(ws, cache)).toBe("__row_index__ IN (1, 2, 3)");

    ws.pinCache(cache);
    expect(ws.frozenRows.get(cache)).toEqual([rowIndex(1), rowIndex(2), rowIndex(3)]); // pinned BY VALUE
    // upstream lasso changes — cached output unaffected
    ws.emitLasso(sc, "__row_index__ IN (9)", [rowIndex(9)]);
    expect(cookSql(ws, cache)).toBe("__row_index__ IN (1, 2, 3)");
  });

  test("pin materializes a durable IN-list from rowIds, not a transient temp-table sql", () => {
    const ws = makeWs();
    const obs = ws.addNode("obs", { x: 0, y: 0 }, "obs");
    const sc = ws.addNode("scatter", { x: 100, y: 0 });
    const cache = ws.addNode("cache", { x: 200, y: 0 });
    ws.connect(obs, sc);
    ws.connect(sc, cache);

    // Large-lasso shape: live sql references a per-session server temp table
    // (dropped when the scatter clears), but the rows travel alongside it.
    ws.emitLasso(sc, "__row_index__ IN (SELECT row FROM sel_scatter_x /* tok=3 */)", [
      rowIndex(10),
      rowIndex(11),
      rowIndex(12),
    ]);
    expect(ws.pinCache(cache)).toBe(true);
    // Frozen predicate is the self-contained rows, NOT the temp-table ref.
    expect(cookSql(ws, cache)).toBe("__row_index__ IN (10, 11, 12)");
  });

  test("scatter freeze affordance mints a ◆ Cache node wired to the lasso (R7)", () => {
    const ws = makeWs();
    const obs = ws.addNode("obs", { x: 0, y: 0 }, "obs");
    const sc = ws.addNode("scatter", { x: 100, y: 0 });
    ws.connect(obs, sc);
    ws.emitLasso(sc, "__row_index__ IN (4, 5)", [rowIndex(4), rowIndex(5)]);

    const cacheId = ws.freezeSelection(sc);
    expect(cacheId).not.toBeNull();
    expect(ws.store.state.nodes[cacheId!].type).toBe("cache"); // NOT "selection"
    expect(ws.isCached(cacheId!)).toBe(true);
    expect(cookSql(ws, cacheId!)).toBe("__row_index__ IN (4, 5)");

    // re-freezing the same scatter re-pins the SAME cache node (Recache)
    ws.emitLasso(sc, "__row_index__ IN (7)", [rowIndex(7)]);
    const again = ws.freezeSelection(sc);
    expect(again).toBe(cacheId);
    expect(cookSql(ws, cacheId!)).toBe("__row_index__ IN (7)");
  });

  test("pinCache with no live input is a no-op", () => {
    const ws = makeWs();
    const obs = ws.addNode("obs", { x: 0, y: 0 }, "obs");
    const cache = ws.addNode("cache", { x: 200, y: 0 });
    ws.connect(obs, cache); // obs emits null ("everything")
    expect(ws.pinCache(cache)).toBe(false);
    expect(ws.isCached(cache)).toBe(false);
  });
});

describe("Export node (decoupled from Cache)", () => {
  test("saves the live sel input's rows — no pinning, reads input directly", async () => {
    const ws = makeWs();
    const obs = ws.addNode("obs", { x: 0, y: 0 }, "obs");
    const sc = ws.addNode("scatter", { x: 100, y: 0 });
    const exp = ws.addNode("export", { x: 200, y: 0 });
    ws.connect(obs, sc);
    ws.connect(sc, exp); // sel push wire
    ws.emitLasso(sc, "__row_index__ IN (1, 2, 3)", [rowIndex(1), rowIndex(2), rowIndex(3)]);

    let captured: unknown = null;
    const orig = globalThis.fetch;
    globalThis.fetch = ((_url: string, init: RequestInit) => {
      captured = JSON.parse(init.body as string);
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ result: { collection_id: "c1" } }),
      } as Response);
    }) as typeof fetch;

    try {
      const res = await ws.saveAsCollection(exp, "my set");
      expect(res.ok).toBe(true);
      expect(captured).toEqual({ name: "my set", row_indices: [1, 2, 3] });
      // decoupled: the export node never pins (Cache's frozenRows untouched)
      expect(ws.frozenRows.has(exp)).toBe(false);
    } finally {
      globalThis.fetch = orig;
    }
  });

  test("refuses a pred-only input — no row ids to save", async () => {
    const ws = makeWs();
    const obs = ws.addNode("obs", { x: 0, y: 0 }, "obs");
    const wr = ws.addNode("wrangle", { x: 100, y: 0 });
    const exp = ws.addNode("export", { x: 200, y: 0 });
    ws.connect(obs, wr);
    ws.connect(wr, exp);
    ws.setWranglePred(wr, "x > 1");

    const res = await ws.saveAsCollection(exp, "preds");
    expect(res.ok).toBe(false);
    expect(res.error).toContain("row selection");
  });
});
