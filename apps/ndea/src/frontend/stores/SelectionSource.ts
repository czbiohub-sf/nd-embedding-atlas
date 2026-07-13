import type { PanelId } from "../lib/branded-types";

/**
 * SelectionSource — fully-tagged identity for a selection broadcast.
 *
 *   { kind: "panel"; panelId }    — a real scatter panel originated this
 *                                   selection (lasso, marquee, etc.)
 *   { kind: "external"; id }      — a non-panel source (active collection,
 *                                   future programmatic sources)
 *
 * Lives in its own file (not co-located with SelectionSyncStore) to avoid a
 * cycle: RoaringBroadcastStore needs the type to key its bitmap map, and
 * SelectionSyncStore writes through RoaringBroadcastStore.
 */
export type SelectionSource = { kind: "panel"; panelId: PanelId } | { kind: "external"; id: string };

export const panelSource = (panelId: PanelId): SelectionSource => ({ kind: "panel", panelId });
export const externalSource = (id: string): SelectionSource => ({ kind: "external", id });

/** Stable string key for use as a Map key. */
export function sourceKey(s: SelectionSource): string {
  return s.kind === "panel" ? `p:${s.panelId}` : `e:${s.id}`;
}

/** Compare two sources for identity. */
export function sourcesEqual(a: SelectionSource, b: SelectionSource): boolean {
  if (a.kind !== b.kind) return false;
  return a.kind === "panel" ? a.panelId === (b as { panelId: PanelId }).panelId : a.id === (b as { id: string }).id;
}
