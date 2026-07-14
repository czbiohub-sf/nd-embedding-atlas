import { useSelector } from "@tanstack/react-store";
import { Store } from "@tanstack/store";
import { useMemo } from "react";
import { setPanelOpen } from "@/stores/panel-registry";

export interface SelectionSource {
  selectionCount: number;
  getRowIndices: () => readonly number[];
}

export interface OpenOptions {
  /** When true, the save section starts expanded. */
  expandSave?: boolean;
}

interface CollectionsSheetSnapshot {
  selection: SelectionSource | null;
  autoExpandSave: boolean;
}

export interface CollectionsSheetState extends CollectionsSheetSnapshot {
  openSheet: (source: SelectionSource | null, options?: OpenOptions) => void;
  consumeAutoExpand: () => void;
}

const collectionsSheetStore = new Store<CollectionsSheetSnapshot>({
  selection: null,
  autoExpandSave: false,
});

export function openCollectionsSheet(source: SelectionSource | null, options?: OpenOptions): void {
  collectionsSheetStore.setState(() => ({
    selection: source,
    autoExpandSave: options?.expandSave === true,
  }));
  setPanelOpen("collections", true);
}

export function consumeCollectionsSheetAutoExpand(): void {
  collectionsSheetStore.setState((state) => (state.autoExpandSave ? { ...state, autoExpandSave: false } : state));
}

export function useCollectionsSheet(): CollectionsSheetState {
  const snapshot = useSelector(collectionsSheetStore, (state) => state);
  return useMemo(
    () => ({
      ...snapshot,
      openSheet: openCollectionsSheet,
      consumeAutoExpand: consumeCollectionsSheetAutoExpand,
    }),
    [snapshot],
  );
}
