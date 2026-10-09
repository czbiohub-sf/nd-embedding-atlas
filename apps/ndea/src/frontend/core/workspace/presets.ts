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
 * Smart FOV selection: one dashboard for picking which fields of view are worth
 * imaging, from a per-FOV feature table paired with its HCS plate.
 *
 * Rows here are whole fields, not cells, so the gallery is re-framed: at the
 * cell-framing default (half 150) a 1193×1664 field renders a 300×300 centre
 * window — 4.5% of it, and unreadable. `half` covers the long axis instead and
 * `size` downsamples, which also keeps a thumbnail near 8 KB rather than 56 KB.
 */
export function seedSmartFovSelection(ws: Workspace): void {
  const obs = ws.addNode("obs", { x: 30, y: 320 }, "obs");
  const wr = ws.addNode("wrangle", { x: 520, y: 260 });
  const count = ws.addNode("count", { x: 1100, y: 0 });
  const scatter = ws.addNode("scatter", { x: 1100, y: 220 });
  const table = ws.addNode("table", { x: 1100, y: 700 });
  const gallery = ws.addNode("gallery", { x: 1700, y: 300 });
  const fovLabel = ws.addNode("fov-label", { x: 1700, y: 900 });
  const fovScore = ws.addNode("fov-score", { x: 2300, y: 480 });

  ws.connect(obs, wr);
  ws.connect(wr, count);
  ws.connect(wr, scatter);
  ws.connect(wr, table);
  // Gallery hangs off wrangle directly, NOT off a cache checkpoint the way the
  // annotate preset does. Cache emits nothing until a scope is pinned, and an operator
  // opening this mid-run needs every candidate FOV on screen at once, not after a
  // lasso-and-freeze. Crossfilter still narrows the set live.
  ws.connect(wr, gallery);
  ws.connect(wr, fovLabel);
  // Wired for graph citizenship, not for filtering: the score node reads the whole feature
  // matrix regardless, because an accuracy readout that moved when someone lassoed in another
  // panel would be measuring the lasso rather than the model.
  ws.connect(wr, fovScore);

  // An identity wrangle emits a null predicate, and the gallery reads null as
  // "no input wired" rather than "everything" -- so it would open empty. Seed an
  // explicitly-true predicate so all candidate FOVs are on screen immediately.
  // Editing the PRQL replaces this; clearing it puts the gallery back to empty.
  ws.updateNodeConfig(wr, { predicateSql: "TRUE" });

  // half 832 = half the 1664px long axis, so the square crop covers the whole
  // field (the 1193px narrow axis pads). Hard-coded until the server exposes
  // per-dataset image dims and the gallery can derive this itself.
  ws.updateNodeConfig(gallery, { half: 832, size: 320 });
  // Same whole-field framing; `size` is the fetched crop resolution and `cellPx` the
  // on-screen cell, kept a little larger than the default cell so zooming in stays sharp.
  ws.updateNodeConfig(fovLabel, { half: 832, size: 192, cellPx: 96 });

  for (const nodeId of [scatter, table]) {
    ws.coordination.assignScope(nodeId, "filter", "A");
  }
  // fov-score joins the focus scope but NOT the filter scope: clicking a FOV anywhere marks
  // where it sits on every feature histogram, while the population being scored stays whole.
  for (const nodeId of [scatter, table, gallery, fovLabel, fovScore]) {
    ws.coordination.assignScope(nodeId, "focus", "A");
  }
  ws.setDisposition("hidden");
  ws.selectNode(scatter);
}

/** Known presets by name. `annotate` is the default a no-`--preset` build opens. */
const PRESETS: Record<string, PresetSeeder> = {
  annotate: seedAnnotate,
  "smart-fov-selection": seedSmartFovSelection,
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
