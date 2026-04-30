import { useHotkey } from "@tanstack/react-hotkeys";
import { createContext, type ReactNode, useCallback, useContext, useMemo, useRef, useState } from "react";
import { CollectionsSheet } from "./CollectionsSheet";

interface SelectionSource {
  selectionCount: number;
  getRowIndices: () => readonly number[];
}

interface OpenOptions {
  /** When true, the SaveCollectionSection inside the sheet starts expanded. */
  expandSave?: boolean;
}

interface CollectionsSheetState {
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

const CollectionsSheetContext = createContext<CollectionsSheetState | null>(null);

export function CollectionsSheetProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [autoExpandSave, setAutoExpandSave] = useState(false);
  const selectionRef = useRef<SelectionSource | null>(null);
  const [selectionVersion, setSelectionVersion] = useState(0);

  const toggle = useCallback(() => setOpen((o) => !o), []);

  const openSheet = useCallback((source: SelectionSource | null, options?: OpenOptions) => {
    selectionRef.current = source;
    setSelectionVersion((v) => v + 1);
    setAutoExpandSave(options?.expandSave === true);
    setOpen(true);
  }, []);

  const consumeAutoExpand = useCallback(() => setAutoExpandSave(false), []);

  useHotkey("Mod+B", toggle, { preventDefault: true });

  const value = useMemo<CollectionsSheetState>(
    () => ({
      open,
      setOpen,
      toggle,
      openSheet,
      selection: selectionRef.current,
      autoExpandSave,
      consumeAutoExpand,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [open, toggle, openSheet, autoExpandSave, consumeAutoExpand, selectionVersion],
  );

  return (
    <CollectionsSheetContext.Provider value={value}>
      {children}
      <CollectionsSheet open={open} onOpenChange={setOpen} />
    </CollectionsSheetContext.Provider>
  );
}

// eslint-disable-next-line react/only-export-components
export function useCollectionsSheet(): CollectionsSheetState {
  const ctx = useContext(CollectionsSheetContext);
  if (!ctx) throw new Error("useCollectionsSheet must be used inside CollectionsSheetProvider");
  return ctx;
}
