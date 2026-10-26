/**
 * ViewerZStore: shares the viewer's live Z-plane index to components outside
 * the viewer tree (the galleries), mirroring ViewerChannelsStore.
 *
 * Crops default their Z to the per-obs `z` column when the dataset has one;
 * otherwise they fall back to whatever Z plane the viewer is currently showing
 * (what was set in idetik). The gallery reads this store for that fallback.
 *
 * Keyed by the same slot as channels (dashboard element id, "docked", or a
 * dataset key).
 */

import { Store } from "@tanstack/store";

interface ViewerZState {
  slots: Record<string, number>;
}

const initialState: ViewerZState = { slots: {} };
export const viewerZStore = new Store(initialState);

export function publishViewerZ(slot: string, zIndex: number): void {
  viewerZStore.setState((prev) => {
    if (prev.slots[slot] === zIndex) return prev;
    return { slots: { ...prev.slots, [slot]: zIndex } };
  });
}

export function clearViewerZ(slot: string): void {
  viewerZStore.setState((prev) => {
    if (!(slot in prev.slots)) return prev;
    const next = { ...prev.slots };
    delete next[slot];
    return { slots: next };
  });
}
