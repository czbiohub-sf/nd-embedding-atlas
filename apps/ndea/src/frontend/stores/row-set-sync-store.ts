import { Store } from "@tanstack/store";
import type { RowIndex } from "@ndea/sdk";
import { type RowSetSource, panelSource, externalSource, sourceKey, sourcesEqual } from "./row-set-source";
import { updateBroadcastBitmap } from "./roaring-broadcast-store";

// Re-export source helpers from the store's public row-set surface.
export { type RowSetSource, panelSource, externalSource, sourceKey, sourcesEqual };

// Discriminated union: invalid states are unrepresentable.
// "empty" guarantees no row indices exist; "active" guarantees both are set.
// Row indices are NOT stored inline — read them via getBitmapRowIndices(source) from
// RoaringBroadcastStore to avoid cloning large arrays into the store.
export type RowSetSyncState =
  | { type: "empty"; source: RowSetSource | null }
  | { type: "active"; source: RowSetSource; version: number };

// Module singleton (not React context) because:
// 1. Global state — one selection across the whole app
// 2. store.subscribe() → zero React re-renders on every selection event
export const rowSetSyncStore = new Store<RowSetSyncState>({
  type: "empty",
  source: null,
});

export function broadcastRowSet(source: RowSetSource, rowIndices: RowIndex[]): void {
  // Write row indices into the WASM bitmap first — subscribers read from there.
  updateBroadcastBitmap(source, rowIndices);
  rowSetSyncStore.setState((s) => ({
    type: "active",
    source,
    version: s.type === "active" ? s.version + 1 : 1,
  }));
}

export function clearRowSetSync(source: RowSetSource | null = null): void {
  rowSetSyncStore.setState(() => ({ type: "empty", source }));
}
