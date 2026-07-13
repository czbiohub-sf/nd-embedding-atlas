import { Kbd, KbdGroup, KbdMod } from "@/components/ui/kbd";
import { CollectionsList } from "./CollectionsList";
import { useCollectionsSheet } from "./collectionsSheetContext";
import { SaveCollectionSection } from "./SaveCollectionSection";

export function CollectionsSheetBody() {
  const { selection, autoExpandSave, consumeAutoExpand } = useCollectionsSheet();
  const hasSelection = selection != null && selection.selectionCount > 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {hasSelection && selection && (
        <SaveCollectionSection
          getRowIndices={selection.getRowIndices}
          selectionCount={selection.selectionCount}
          autoExpand={autoExpandSave}
          onAutoExpandConsumed={consumeAutoExpand}
        />
      )}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <CollectionsList />
      </div>
      <div className="flex items-center justify-between gap-2 border-border border-t bg-muted/40 px-4 py-2 text-2xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          Toggle{" "}
          <KbdGroup>
            <KbdMod />
            <Kbd>B</Kbd>
          </KbdGroup>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Kbd>Esc</Kbd> to close
        </span>
      </div>
    </div>
  );
}
