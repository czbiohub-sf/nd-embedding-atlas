import { describe, expect, test } from "bun:test";

import { resolvePreset, resolvePresetOrDefault } from "./presets";
import { createNativeAppNodeLibrary } from "@/core/node/library";
import { Workspace } from "./workspace-store";
import type { Metadata } from "@ndea/protocol";

const nativeWorkspaceNodeLibrary = createNativeAppNodeLibrary();

// rAF doesn't exist under bun:test: the Workspace ctor references it for the
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

  test("defaults and falls back to the annotate preset", () => {
    expect(resolvePresetOrDefault()).toBe(resolvePresetOrDefault("annotate"));
    expect(resolvePresetOrDefault("does-not-exist")).toBe(resolvePresetOrDefault("annotate"));
  });
});

describe("seedAnnotate", () => {
  test("builds the annotate graph: all R9 node types present, dataset-agnostic", () => {
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
    // embedding, the wrangle is identity): nothing pins a specific dataset.
    for (const n of nodes) expect(n.config).toBeUndefined();
  });

  test("wires data channels and coordinates every interactive view on one focus", () => {
    const ws = makeWs();
    resolvePreset("annotate")!(ws);

    const byType = Object.fromEntries(
      Object.values(ws.store.state.nodes).map((n) => [n.definitionRef.nodeTypeId, n.id]),
    );
    const edges = Object.values(ws.store.state.edges);
    const edge = (from: string, to: string) =>
      edges.find((candidate) => candidate.from === byType[from] && candidate.to === byType[to]);

    expect(edge("obs", "wrangle")).toMatchObject({ fromPort: "out", toPort: "in", kind: "pred" });
    expect(edge("wrangle", "scatter")).toMatchObject({ fromPort: "out", toPort: "in", kind: "pred" });
    expect(edge("scatter", "cache")).toBeUndefined();
    expect(edge("cache", "annotate")).toMatchObject({ fromPort: "out", toPort: "in", kind: "pred" });
    expect(edge("cache", "gallery")).toMatchObject({ fromPort: "out", toPort: "in", kind: "pred" });
    expect(edges).toHaveLength(6);

    for (const type of ["table", "scatter", "annotate", "image-viewer", "gallery"]) {
      expect(ws.store.state.coordinationScopes[byType[type]]?.focus).toBe("A");
    }
    for (const type of ["table", "scatter", "cache"]) {
      expect(ws.store.state.coordinationScopes[byType[type]]?.filter).toBe("A");
    }
  });

  test("matches the authoring layout and selects the table focus source", () => {
    const ws = makeWs();
    resolvePreset("annotate")!(ws);
    const byType = Object.fromEntries(
      Object.values(ws.store.state.nodes).map((node) => [node.definitionRef.nodeTypeId, node.id]),
    );

    expect(ws.store.state.positions).toMatchObject({
      [byType.obs]: { x: 30, y: 320 },
      [byType.wrangle]: { x: 520, y: 260 },
      [byType.count]: { x: 1100, y: 0 },
      [byType.table]: { x: 1100, y: 220 },
      [byType.scatter]: { x: 1100, y: 650 },
      [byType["image-viewer"]]: { x: 1650, y: 100 },
      [byType.cache]: { x: 1650, y: 700 },
      [byType.gallery]: { x: 2200, y: 0 },
      [byType.annotate]: { x: 2150, y: 620 },
    });
    expect(ws.store.state.selectedNodeId).toBe(byType.table);
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

const typeIds = (ws: ReturnType<typeof makeWs>) =>
  Object.fromEntries(Object.values(ws.store.state.nodes).map((n) => [n.definitionRef.nodeTypeId, n.id]));

describe("seedSmartFovSelection", () => {
  const seed = () => {
    const ws = makeWs();
    resolvePreset("smart-fov-selection")!(ws);
    return ws;
  };

  test("is registered and dataset-agnostic", () => {
    expect(typeof resolvePreset("smart-fov-selection")).toBe("function");
    const types = new Set<string>(Object.values(seed().store.state.nodes).map((n) => n.definitionRef.nodeTypeId));
    for (const t of ["obs", "wrangle", "count", "scatter", "table", "gallery", "fov-label", "fov-score"]) {
      expect(types.has(t)).toBe(true);
    }
    // No cache: it emits nothing until a scope is pinned, which would leave the
    // gallery on "No input wired" when the dashboard opens.
    expect(types.has("cache")).toBe(false);
  });

  test("re-frames the gallery to whole-FOV crops", () => {
    // Regression guard: at the cell-framing default (half 150) a 1193x1664 field
    // renders a 300x300 centre window -- 4.5% of it, and unreadable as QC.
    const ws = seed();
    expect(ws.store.state.nodes[typeIds(ws).gallery].config).toMatchObject({
      value: { half: 832, size: 320 },
    });
  });

  test("wires the graph and shares one filter and focus scope", () => {
    const ws = seed();
    const byType = typeIds(ws);
    const edges = Object.values(ws.store.state.edges);
    const edge = (from: string, to: string) =>
      edges.find((candidate) => candidate.from === byType[from] && candidate.to === byType[to]);

    expect(edge("obs", "wrangle")).toMatchObject({ fromPort: "out", toPort: "in" });
    expect(edge("wrangle", "scatter")).toMatchObject({ fromPort: "out", toPort: "in" });
    // Straight from wrangle, so crops are on screen at open rather than waiting
    // on a lasso-and-pin through a cache checkpoint.
    expect(edge("wrangle", "gallery")).toMatchObject({ fromPort: "out", toPort: "in" });
    expect(edge("wrangle", "fov-label")).toMatchObject({ fromPort: "out", toPort: "in" });
    expect(edge("wrangle", "fov-score")).toMatchObject({ fromPort: "out", toPort: "in" });

    // Deliberately NOT in the filter scope: the score node reads the whole feature matrix, so
    // an accuracy readout that moved with someone else's lasso would be measuring the lasso.
    expect(ws.store.state.coordinationScopes[byType["fov-score"]]?.filter).toBeUndefined();

    for (const type of ["scatter", "table", "gallery", "fov-label", "fov-score"]) {
      expect(ws.store.state.coordinationScopes[byType[type]]?.focus).toBe("A");
    }
    for (const type of ["scatter", "table"]) {
      expect(ws.store.state.coordinationScopes[byType[type]]?.filter).toBe("A");
    }
  });

  test("opens to Stage with the Canvas hidden", () => {
    const ws = seed();
    expect(ws.store.state.disposition).toBe("hidden");
    const staged = new Set<string>(ws.stagedIds().map((id) => ws.store.state.nodes[id].definitionRef.nodeTypeId));
    for (const t of ["scatter", "table", "gallery", "fov-label", "fov-score"]) expect(staged.has(t)).toBe(true);
    for (const t of ["obs", "wrangle"]) expect(staged.has(t)).toBe(false);
  });
});
