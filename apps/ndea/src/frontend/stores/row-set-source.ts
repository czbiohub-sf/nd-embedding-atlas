import type { PanelId } from "../lib/branded-types";

/**
 * RowSetSource — fully-tagged identity for a row-set broadcast.
 *
 *   { kind: "panel"; panelId }    — a real scatter panel originated this
 *                                   selection (lasso, marquee, etc.)
 *   { kind: "external"; id }      — a non-panel source (active collection,
 *                                   future programmatic sources)
 *
 * Lives in its own file (not co-located with RowSetSyncStore) to avoid a
 * cycle: RoaringBroadcastStore needs the type to key its bitmap map, and
 * RowSetSyncStore writes through RoaringBroadcastStore.
 */
export type RowSetSource = { kind: "panel"; panelId: PanelId } | { kind: "external"; id: string };

export const panelSource = (panelId: PanelId): RowSetSource => ({ kind: "panel", panelId });
export const externalSource = (id: string): RowSetSource => ({ kind: "external", id });

/** Stable string key for use as a Map key. */
export function sourceKey(s: RowSetSource): string {
  return s.kind === "panel" ? `p:${s.panelId}` : `e:${s.id}`;
}

/** Compare two sources for identity. */
export function sourcesEqual(a: RowSetSource, b: RowSetSource): boolean {
  if (a.kind !== b.kind) return false;
  return a.kind === "panel" ? a.panelId === (b as { panelId: PanelId }).panelId : a.id === (b as { id: string }).id;
}
