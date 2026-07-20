/**
 * ViewerZStore: shares the viewer's live Z-plane index to components outside
 * the viewer tree (the galleries), mirroring ViewerChannelsStore.
 *
 * Crops default their Z to the per-obs `z` column when the dataset has one;
 * otherwise they fall back to whatever Z plane the viewer is currently showing
 * (what was set in idetik). The gallery reads this store for that fallback.
 *
 * Keyed by the same instanceId as channels ("docked" for the single docked
 * viewer, `datasetKey` for per-dataset floating viewers).
 */

import { Store } from "@tanstack/store";

export interface ViewerZState {
  slots: Record<string, number>;
}

const initialState: ViewerZState = { slots: {} };
export const viewerZStore = new Store(initialState);

export function publishViewerZ(instanceId: string, zIndex: number): void {
  viewerZStore.setState((prev) => {
    if (prev.slots[instanceId] === zIndex) return prev;
    return { slots: { ...prev.slots, [instanceId]: zIndex } };
  });
}

export function clearViewerZ(instanceId: string): void {
  viewerZStore.setState((prev) => {
    if (!(instanceId in prev.slots)) return prev;
    const next = { ...prev.slots };
    delete next[instanceId];
    return { slots: next };
  });
}
