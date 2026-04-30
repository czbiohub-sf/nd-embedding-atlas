/**
 * CollectionsSheetContext — split out of the Provider module so descendants
 * (CollectionsSheet, CollectionsSheetBody, SaveCollectionSection) can read
 * the hook without importing the Provider, breaking the
 *   Provider → Sheet → Body → Provider
 * import cycle that fallow flagged.
 */

import { createContext, useContext } from "react";

export interface SelectionSource {
  selectionCount: number;
  getRowIndices: () => readonly number[];
}

export interface OpenOptions {
  /** When true, the SaveCollectionSection inside the sheet starts expanded. */
  expandSave?: boolean;
}

export interface CollectionsSheetState {
  open: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;
  /**
   * Open the sheet from the bookmark trigger. Pass the live selection
   * source so the save section can read indices at submit time and the
   * banner can show the current count.
   */
  openSheet: (source: SelectionSource | null, options?: OpenOptions) => void;
  /** Live selection state for descendants — null when no selection. */
  selection: SelectionSource | null;
  /** Read-once flag used by SaveCollectionSection to start expanded. */
  autoExpandSave: boolean;
  /** Called by the section after consuming `autoExpandSave`. */
  consumeAutoExpand: () => void;
}

export const CollectionsSheetContext = createContext<CollectionsSheetState | null>(null);

export function useCollectionsSheet(): CollectionsSheetState {
  const ctx = useContext(CollectionsSheetContext);
  if (!ctx) throw new Error("useCollectionsSheet must be used inside CollectionsSheetProvider");
  return ctx;
}
