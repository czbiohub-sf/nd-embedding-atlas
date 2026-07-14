import { describe, expect, test } from "bun:test";

import { resolvePreset } from "./presets";
import { createNativeAppNodeLibrary } from "@/core/node/library";
import { Workspace } from "./workspace-store";
import type { Metadata } from "@ndea/protocol";

const nativeWorkspaceNodeLibrary = createNativeAppNodeLibrary();

// rAF doesn't exist under bun:test — the Workspace ctor references it for the
// flush scheduler. We only inspect the store synchronously, so a stub is enough.
(globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame ??= (() => 0) as unknown;

function makeWs() {
  return new Workspace({
    coordinator: { query: () => Promise.resolve([]) } as never,
    table: "atlas",
    metadata: { dataset_keys: [] } as unknown as Metadata,
    nodeLibrary: nativeWorkspaceNodeLibrary,
  });
}

describe("resolvePreset", () => {
  test("returns a seeder for a known preset", () => {
    expect(typeof resolvePreset("annotate")).toBe("function");
  });

  test("returns null for an unknown preset name (no throw)", () => {
    expect(resolvePreset("does-not-exist")).toBeNull();
  });
});

describe("seedAnnotate", () => {
  test("builds the annotate graph — all R9 node types present, dataset-agnostic", () => {
    const ws = makeWs();
    resolvePreset("annotate")!(ws);

    const nodes = Object.values(ws.store.state.nodes);
    const types = new Set<string>(nodes.map((n) => n.definitionRef.nodeTypeId));
    for (const t of ["obs", "wrangle", "count", "table", "scatter", "cache", "annotate", "image-viewer", "gallery"]) {
      expect(types.has(t)).toBe(true);
    }
    expect(types.has("selection")).toBe(false);
    expect(types.has("fov")).toBe(false);
    // Dataset-agnostic: no baked config (the scatter uses the dataset's default
    // embedding, the wrangle is identity) — nothing pins a specific dataset.
    for (const n of nodes) expect(n.config).toBeUndefined();
  });

  test("wires the lasso → cache → annotate / gallery chain (edges cook)", () => {
    const ws = makeWs();
    resolvePreset("annotate")!(ws);

    const byType = Object.fromEntries(
      Object.values(ws.store.state.nodes).map((n) => [n.definitionRef.nodeTypeId, n.id]),
    );
    const edges = Object.values(ws.store.state.edges);
    const wired = (from: string, to: string) => edges.some((e) => e.from === byType[from] && e.to === byType[to]);

    expect(wired("obs", "wrangle")).toBe(true);
    expect(wired("wrangle", "scatter")).toBe(true);
    expect(wired("scatter", "cache")).toBe(true);
    expect(wired("cache", "annotate")).toBe(true);
    expect(wired("cache", "gallery")).toBe(true);
    expect(wired("table", "image-viewer")).toBe(true);
  });

  test("opens to Stage with the Canvas hidden (R10)", () => {
    const ws = makeWs();
    resolvePreset("annotate")!(ws);
    expect(ws.store.state.disposition).toBe("hidden");
    // The five stageable views tile; obs/wrangle/count/cache stay off-stage.
    const staged = new Set<string>(ws.stagedIds().map((id) => ws.store.state.nodes[id].definitionRef.nodeTypeId));
    for (const t of ["scatter", "table", "annotate", "image-viewer", "gallery"]) expect(staged.has(t)).toBe(true);
    for (const t of ["obs", "wrangle", "count", "cache"]) expect(staged.has(t)).toBe(false);
  });
});
