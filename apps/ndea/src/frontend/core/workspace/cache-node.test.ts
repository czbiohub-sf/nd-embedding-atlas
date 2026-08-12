import { describe, expect, test } from "bun:test";
import { rowIndex } from "@ndea/sdk";
import { predicateSql } from "@/core/graph/cook";
import { createNativeAppNodeLibrary } from "@/core/node/library";
import { Workspace } from "./workspace-store";
import type { Metadata } from "@ndea/protocol";

const library = createNativeAppNodeLibrary();
(globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame ??= (() => 0) as unknown;

function makeWs() {
  return new Workspace({
    coordinator: { query: () => Promise.resolve([]) } as never,
    table: "atlas",
    metadata: { dataset_keys: [] } as unknown as Metadata,
    nodeLibrary: library,
  });
}

describe("Cache node", () => {
  test("combines live graph predicate and freezes row identities", () => {
    const ws = makeWs();
    const obs = ws.addNode("obs", { x: 0, y: 0 }, "obs");
    const wrangle = ws.addNode("wrangle", { x: 100, y: 0 });
    const cache = ws.addNode("cache", { x: 200, y: 0 });
    ws.connect(obs, wrangle);
    ws.connect(wrangle, cache);
    ws.updateNodeConfig(wrangle, { predicateSql: "x > 1" });
    ws.setLiveCachePredicate(cache, "(x > 1) AND (y < 9)");

    expect(predicateSql(ws.pullGraphNode(cache))).toBe("(x > 1) AND (y < 9)");
    expect(ws.pinCache(cache, [rowIndex(3), rowIndex(8)])).toBe(true);
    ws.setLiveCachePredicate(cache, "x > 999");
    expect(predicateSql(ws.pullGraphNode(cache))).toBe("__row_index__ IN (3, 8)");

    ws.uncache(cache);
    expect(predicateSql(ws.pullGraphNode(cache))).toBe("x > 999");
  });

  test("active-empty pin remains an empty predicate", () => {
    const ws = makeWs();
    const cache = ws.addNode("cache", { x: 0, y: 0 });
    ws.pinCache(cache, []);
    expect(predicateSql(ws.pullGraphNode(cache))).toBe("FALSE");
  });
});
