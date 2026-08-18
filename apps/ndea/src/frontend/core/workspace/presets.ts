/** Dataset-agnostic workspace seeders. */

import type { Workspace } from "./workspace-store";

export type PresetSeeder = (ws: Workspace) => void;

export function seedAnnotate(ws: Workspace): void {
  const obs = ws.addNode("obs", { x: 30, y: 320 }, "obs");
  const wr = ws.addNode("wrangle", { x: 520, y: 260 });
  const count = ws.addNode("count", { x: 1100, y: 0 });
  const table = ws.addNode("table", { x: 1100, y: 220 });
  const scatter = ws.addNode("scatter", { x: 1100, y: 650 });
  const cache = ws.addNode("cache", { x: 1650, y: 700 });
  const annotate = ws.addNode("annotate", { x: 2150, y: 620 });
  const imageViewer = ws.addNode("image-viewer", { x: 1650, y: 100 });
  const gallery = ws.addNode("gallery", { x: 2200, y: 0 });
  ws.connect(obs, wr);
  ws.connect(wr, count);
  ws.connect(wr, table);
  ws.connect(wr, scatter);
  ws.connect(cache, annotate, "out", "in"); // annotate the cached scope
  ws.connect(cache, gallery, "out", "in"); // gallery crops for the cached scope
  for (const nodeId of [table, scatter, cache]) {
    ws.coordination.assignScope(nodeId, "filter", "A");
  }
  for (const nodeId of [table, scatter, annotate, imageViewer, gallery]) {
    ws.coordination.assignScope(nodeId, "focus", "A");
  }
  ws.setDisposition("hidden"); // opens on Stage with the Canvas hidden (R10)
  ws.selectNode(table);
}

/**
 * Regularizer sweep review: judge each reconstruction of an FOV good or bad.
 *
 * Unlike {@link seedAnnotate} this preset names columns (`row_idx`, `reg_power`),
 * because "which column groups a sweep" is not inferable. They are seeded as
 * Carousel CONFIG, not assumed by the node: on a dataset without them the
 * carousel simply opens on its column pickers rather than breaking.
 *
 * Wiring: Wrangle scopes which FOVs are in play, Scatter and Table select one,
 * and the shared `focus` group fans that obs out to the Carousel (which expands
 * it into its 25 regularizer peers) and to the Image Viewer (which shows the
 * selected peer live, at full interactivity).
 */
export function seedRegularizer(ws: Workspace): void {
  const obs = ws.addNode("obs", { x: 30, y: 320 }, "obs");
  const wr = ws.addNode("wrangle", { x: 520, y: 260 });
  const table = ws.addNode("table", { x: 1100, y: 40 });
  const scatter = ws.addNode("scatter", { x: 1100, y: 520 });
  const carousel = ws.addNode("carousel", { x: 1700, y: 240 });
  const imageViewer = ws.addNode("image-viewer", { x: 2320, y: 60 });
  ws.connect(obs, wr);
  ws.connect(wr, table);
  ws.connect(wr, scatter);
  ws.connect(wr, carousel); // the scope the carousel steps groups through
  ws.updateNodeConfig(carousel, {
    groupBy: "row_idx",
    variantBy: "reg_power",
    column: "reg_verdict",
    labels: ["good", "bad"],
    // Three reconstructions side by side, each a live camera-synced viewport.
    slidesPerView: 3,
  });
  for (const nodeId of [table, scatter]) {
    ws.coordination.assignScope(nodeId, "filter", "A");
  }
  for (const nodeId of [table, scatter, carousel, imageViewer]) {
    ws.coordination.assignScope(nodeId, "focus", "A");
  }
  ws.setDisposition("hidden");
  ws.selectNode(carousel);
}

/** Known presets by name. `annotate` is the default a no-`--preset` build opens. */
const PRESETS: Record<string, PresetSeeder> = {
  annotate: seedAnnotate,
  regularizer: seedRegularizer,
};

/**
 * Resolve a preset name to its seeder, or `null` (with a `console.warn`) for an
 * unknown name. The build load path falls back to {@link seedAnnotate} on null,
 * so a typo'd `--preset` still opens the annotate default rather than nothing.
 */
export function resolvePreset(name: string): PresetSeeder | null {
  const seed = PRESETS[name];
  if (!seed) {
    console.warn(`[preset] unknown preset "${name}"`);
    return null;
  }
  return seed;
}

export function resolvePresetOrDefault(name?: string): PresetSeeder {
  return resolvePreset(name ?? "annotate") ?? seedAnnotate;
}
