import { Store } from "@tanstack/store";
import type { PanelId } from "../lib/branded-types";
import { updateBroadcastBitmap } from "./RoaringBroadcastStore";

// Discriminated union: invalid states are unrepresentable.
// "empty" guarantees no row indices exist; "active" guarantees both are set.
// Row IDs are NOT stored inline — read them via getBitmapRowIds(sourcePanelId)
// from RoaringBroadcastStore to avoid cloning large arrays into the store.
export type SelectionSyncState =
  | { type: "empty"; sourcePanelId: PanelId | null }
  | { type: "active"; sourcePanelId: PanelId; version: number };

// Module singleton (not React context) because:
// 1. Global state — one selection across the whole app
// 2. store.subscribe() → zero React re-renders on every selection event
export const selectionSyncStore = new Store<SelectionSyncState>({
  type: "empty",
  sourcePanelId: null,
});

export function broadcastSelection(panelId: PanelId, rowIds: number[]): void {
  // Write row IDs into the WASM bitmap first — subscribers read from there.
  updateBroadcastBitmap(panelId, rowIds);
  selectionSyncStore.setState((s) => ({
    type: "active",
    sourcePanelId: panelId,
    version: s.type === "active" ? s.version + 1 : 1,
  }));
}

export function clearSelectionSync(sourcePanelId: PanelId | null = null) {
  selectionSyncStore.setState(() => ({ type: "empty", sourcePanelId }));
}
