/** Dataset-agnostic workspace seeders. */

import type { Workspace } from "./workspace-store";

export type PresetSeeder = (ws: Workspace) => void;

export function seedAnnotate(ws: Workspace): void {
  const obs = ws.addNode("obs", { x: 30, y: 340 }, "obs");
  const wr = ws.addNode("wrangle", { x: 290, y: 300 });
  const count = ws.addNode("count", { x: 660, y: 60 });
  const table = ws.addNode("table", { x: 660, y: 200 });
  const scatter = ws.addNode("scatter", { x: 660, y: 460 });
  const cache = ws.addNode("cache", { x: 1040, y: 460 });
  const annotate = ws.addNode("annotate", { x: 1400, y: 460 });
  const fov = ws.addNode("fov", { x: 1040, y: 200 });
  const gallery = ws.addNode("gallery", { x: 1400, y: 200 });
  ws.connect(obs, wr);
  ws.connect(wr, count);
  ws.connect(wr, table);
  ws.connect(wr, scatter);
  ws.connect(scatter, cache); // lasso → the cached working set
  ws.connect(cache, annotate); // annotate the cached scope
  ws.connect(cache, gallery); // gallery crops for the cached scope
  ws.connect(table, fov); // idetik shows the table-focused row's crop
  ws.setDisposition("hidden"); // opens to the tiled dashboard, not the canvas (R10)
  ws.selectNode(scatter);
}

/** Known presets by name. `annotate` is the default a no-`--preset` build opens. */
const PRESETS: Record<string, PresetSeeder> = {
  annotate: seedAnnotate,
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
