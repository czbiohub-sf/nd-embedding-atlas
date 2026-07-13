import { type ReactNode, useCallback, useMemo, useRef, useState } from "react";
import { setPanelOpen } from "@/stores/panelRegistry";
import {
  CollectionsSheetContext,
  type CollectionsSheetState,
  type OpenOptions,
  type SelectionSource,
} from "./collectionsSheetContext";
import { CollectionsSheet } from "./CollectionsSheet";

/**
 * CollectionsSheetProvider — holds the live selection payload for the
 * Collections panel (what the bookmark trigger stashed). Open/size/side state
 * lives in the panel registry (`usePanel("collections")`); this provider only
 * carries the selection source + auto-expand flag across the context split.
 */
export function CollectionsSheetProvider({ children }: { children: ReactNode }) {
  const [autoExpandSave, setAutoExpandSave] = useState(false);
  const selectionRef = useRef<SelectionSource | null>(null);
  const [selectionVersion, setSelectionVersion] = useState(0);

  const openSheet = useCallback((source: SelectionSource | null, options?: OpenOptions) => {
    selectionRef.current = source;
    setSelectionVersion((v) => v + 1);
    setAutoExpandSave(options?.expandSave === true);
    setPanelOpen("collections", true);
  }, []);

  const consumeAutoExpand = useCallback(() => setAutoExpandSave(false), []);

  const value = useMemo<CollectionsSheetState>(
    () => ({
      openSheet,
      selection: selectionRef.current,
      autoExpandSave,
      consumeAutoExpand,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [openSheet, autoExpandSave, consumeAutoExpand, selectionVersion],
  );

  return (
    <CollectionsSheetContext.Provider value={value}>
      {children}
      <CollectionsSheet />
    </CollectionsSheetContext.Provider>
  );
}

// Re-export hook so existing imports `from "./CollectionsSheetProvider"` keep working.
export { useCollectionsSheet } from "./collectionsSheetContext";
