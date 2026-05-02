import { useHotkey } from "@tanstack/react-hotkeys";
import { type ReactNode, useCallback, useMemo, useRef, useState } from "react";
import {
  CollectionsSheetContext,
  type CollectionsSheetState,
  type OpenOptions,
  type SelectionSource,
} from "./collectionsSheetContext";
import { CollectionsSheet } from "./CollectionsSheet";

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

// Re-export hook so existing imports `from "./CollectionsSheetProvider"` keep working.
export { useCollectionsSheet } from "./collectionsSheetContext";
