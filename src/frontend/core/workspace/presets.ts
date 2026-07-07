/**
 * Preset registry — a named seeder that builds a curated graph + stage layout
 * against the live (dataset-bound) workspace.
 *
 * A preset is a SEED FUNCTION, not a frozen document: it calls `ws.addNode` /
 * `ws.connect` exactly like {@link import("./workspace-store").seedWorkspace}, so
 * it is dataset-agnostic by construction — the scatter binds the mounted dataset's
 * default embedding, the wrangle is identity, and crops appear when the dataset
 * carries plate data. Nothing dataset-specific (an obsm key, obs columns, node
 * ids) is baked in, so the same preset opens on any dataset.
 *
 * A shipped build resolves the active preset (default `annotate`) through
 * {@link import("./workspace-context")}'s load-or-seed seam and seeds a fresh
 * graph every launch (read-only session — the preset is authoritative). Dev keeps
 * today's editable localStorage path.
 *
 * Single-entry for now — `annotate`, the default a no-`--preset` build opens.
 */

import type { Workspace } from "./workspace-store";

/** A preset builds its graph + layout against a fresh, dataset-bound workspace. */
export type PresetSeeder = (ws: Workspace) => void;

/**
 * The annotate preset: `obs` → `Wrangle` → `Table` + `Count`; `Wrangle` →
 * `Scatter` → lasso → `Cache` → `Annotate`; `Gallery` renders crops for the
 * cached scope and `Idetik` (`fov`) shows the table-focused row's crop. Opens to
 * the tiled dashboard (`disposition: "hidden"`) — the five stageable views
 * (scatter, table, annotate, fov, gallery) auto-tile; obs/wrangle/count/cache
 * cook but stay off-stage.
 *
 * Dataset-agnostic: every node is added without config, so the scatter uses the
 * dataset's default embedding and the wrangle passes through unfiltered.
 */
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
  ws.select(scatter);
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
