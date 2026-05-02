import { Store } from "@tanstack/store";
import { type SelectionSource, panelSource, externalSource, sourceKey, sourcesEqual } from "./SelectionSource";
import { updateBroadcastBitmap } from "./RoaringBroadcastStore";

// Re-export the source helpers so existing call sites importing from
// SelectionSyncStore continue to work — the cycle between stores is broken
// because both stores now import the type-only module SelectionSource.
export { type SelectionSource, panelSource, externalSource, sourceKey, sourcesEqual };

// Discriminated union: invalid states are unrepresentable.
// "empty" guarantees no row indices exist; "active" guarantees both are set.
// Row IDs are NOT stored inline — read them via getBitmapRowIds(source) from
// RoaringBroadcastStore to avoid cloning large arrays into the store.
export type SelectionSyncState =
  | { type: "empty"; source: SelectionSource | null }
  | { type: "active"; source: SelectionSource; version: number };

// Module singleton (not React context) because:
// 1. Global state — one selection across the whole app
// 2. store.subscribe() → zero React re-renders on every selection event
export const selectionSyncStore = new Store<SelectionSyncState>({
  type: "empty",
  source: null,
});

export function broadcastSelection(source: SelectionSource, rowIds: number[]): void {
  // Write row IDs into the WASM bitmap first — subscribers read from there.
  updateBroadcastBitmap(source, rowIds);
  selectionSyncStore.setState((s) => ({
    type: "active",
    source,
    version: s.type === "active" ? s.version + 1 : 1,
  }));
}

export function clearSelectionSync(source: SelectionSource | null = null) {
  selectionSyncStore.setState(() => ({ type: "empty", source }));
}
