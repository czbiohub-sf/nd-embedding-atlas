import { Store } from "@tanstack/store";
import type { PanelId } from "../scatter-gpu/types";

// Discriminated union: invalid states are unrepresentable.
// "empty" guarantees no row indices exist; "active" guarantees both are set.
export type SelectionSyncState =
  | { type: "empty"; sourcePanelId: null }
  | { type: "active"; selectedRowIndices: number[]; sourcePanelId: PanelId };

// Module singleton (not React context) because:
// 1. Global state — one selection across the whole app
// 2. store.subscribe() → zero React re-renders on every selection event
export const selectionSyncStore = new Store<SelectionSyncState>({
  type: "empty",
  sourcePanelId: null,
});

export function broadcastSelection(id: PanelId, rowIndices: number[]) {
  selectionSyncStore.setState(() => ({
    type: "active",
    selectedRowIndices: rowIndices,
    sourcePanelId: id,
  }));
}

export function clearSelectionSync() {
  selectionSyncStore.setState(() => ({ type: "empty", sourcePanelId: null }));
}
