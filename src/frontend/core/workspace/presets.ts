/**
 * Preset registry — resolve a named preset to a ready-to-hydrate {@link WsState}.
 *
 * A preset is one bundled `PersistedDoc` (graph + saved stage layout). A shipped
 * build loads the resolved state through {@link import("./workspace-context")}'s
 * load-or-seed seam instead of localStorage; the bundled doc is authoritative on
 * every launch (read-only session).
 *
 * Single-entry for now — `annotate`, the default a no-`--preset` build opens. A
 * `presets.json` catalog + shadcn-style registry items arrive with a second preset.
 */

import annotateDoc from "./annotate.doc.json";
import { dropUnknownNodes, migrate, type PersistedDoc, validateDoc } from "./persist";
import type { WsState } from "./types";

/** Known presets by name. `annotate` is the default a no-`--preset` build opens. */
const PRESETS: Record<string, PersistedDoc> = {
  annotate: annotateDoc as unknown as PersistedDoc,
};

/**
 * Resolve a preset name to a validated, ready-to-hydrate {@link WsState} — the
 * bundled analogue of `loadFromStorage`. Runs the doc through the same
 * `migrate` → {@link dropUnknownNodes} → {@link validateDoc} path so a bundled
 * preset carries the identical "never hydrate corrupt state" guarantee. Returns
 * `null` (with a `console.warn`) on an unknown name or a doc that fails validation.
 */
export function resolvePreset(name: string): WsState | null {
  const doc = PRESETS[name];
  if (!doc) {
    console.warn(`[preset] unknown preset "${name}"`);
    return null;
  }
  const migrated = dropUnknownNodes(migrate(doc));
  const res = validateDoc(migrated);
  if (!res.ok) {
    console.warn(`[preset] "${name}" failed validation, ignoring: ${res.errors.join("; ")}`);
    return null;
  }
  return migrated.state;
}
