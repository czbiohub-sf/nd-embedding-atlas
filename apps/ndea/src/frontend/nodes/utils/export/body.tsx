import { useCallback, useState, useSyncExternalStore } from "react";
import type { CollectionMutationResult, CreateCollectionBody } from "@ndea/protocol";
import type { RowIndex } from "@ndea/sdk";

import { NdIconButton } from "@/components/nd/nd-icon-button";
import { NdBracketed, NdCaption, NdChip } from "@/components/nd/nd-primitives";
import { useCreateCollection } from "@/components/collections/useCollections";
import type { NodeBodyProps } from "@/core/node/app-node-host";
import type { CollectionConfig } from "@/nodes/collection/node";
import type { ExportCapabilities } from "./node";

const formatCount = (count: number) => count.toLocaleString("en-US");

interface ExportConfigHost {
  patchConfig(patch: Partial<CollectionConfig>): void;
}

export async function saveExportCollection(
  host: ExportConfigHost,
  name: string,
  rowIds: readonly RowIndex[],
  createCollection: (body: CreateCollectionBody) => Promise<CollectionMutationResult>,
): Promise<void> {
  const result = await createCollection({ name, tags: [], row_indices: [...rowIds] });
  host.patchConfig({
    collectionId: result.result.collection_id,
    collectionName: result.result.name,
    collectionVersion: result.result.version,
  });
}

export function ExportBody({ host }: NodeBodyProps<CollectionConfig, ExportCapabilities>) {
  const createCollection = useCreateCollection();
  const subscribe = useCallback((onChange: () => void) => host.onExternalRowSet(() => onChange()), [host]);
  const rowIds = useSyncExternalStore(
    subscribe,
    () => host.externalRowSet(),
    () => host.externalRowSet(),
  );
  const [name, setName] = useState("");
  const [savedName, setSavedName] = useState(host.config.collectionName ?? null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const rowCount = rowIds?.length ?? null;
  const saveable = rowCount !== null && rowCount > 0;

  if (savedName) {
    return (
      <div className="flex flex-col gap-[7px]" data-nodrag="1">
        <div className="flex items-center gap-1.5">
          <NdChip tone="amber">◆ {savedName}</NdChip>
          <span className="font-mono text-[8.5px] text-text-muted">saved</span>
        </div>
        <NdCaption className="text-[9px]">saved to collections — re-name + save again to fork</NdCaption>
      </div>
    );
  }

  const save = async () => {
    const trimmedName = name.trim();
    if (!trimmedName || !rowIds?.length) return;
    setSaveError(null);
    try {
      await saveExportCollection(host, trimmedName, rowIds, (body) => createCollection.mutateAsync(body));
      setSavedName(trimmedName);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "save failed");
    }
  };

  return (
    <div className="flex flex-col gap-[7px]" data-nodrag="1">
      <div className="font-mono text-3xs text-wire-sel">
        ↓ export {rowCount !== null ? <NdBracketed>{formatCount(rowCount)}</NdBracketed> : null}
        <span className="ml-1 text-text-muted">{saveable ? "rows ready" : "wire a row selection"}</span>
      </div>
      <div className="flex items-center gap-1">
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          onPointerDown={(event) => event.stopPropagation()}
          placeholder="collection name"
          className="h-[18px] min-w-0 flex-1 rounded border border-border bg-muted px-1.5 font-mono text-[9.5px] text-foreground placeholder:text-text-muted"
        />
        <NdIconButton
          icon="freeze"
          label={createCollection.isPending ? "…" : "save"}
          tone="amber"
          title="save the wired row-set as a collection"
          onClick={() => void save()}
        />
      </div>
      {saveError ? <span className="font-mono text-[8.5px] text-destructive">{saveError}</span> : null}
      <NdCaption className="text-[9px]">saves the wired rows as a server collection</NdCaption>
    </div>
  );
}
