import { useState } from "react";
import type { Collection } from "@ndea/protocol";

import { useCollections } from "@/components/collections/useCollections";
import { NdBracketed, NdCaption, NdChip, NdHud } from "@/components/nd/nd-primitives";
import type { NodeBodyProps } from "@/core/node/app-node-host";
import type { CollectionCapabilities, CollectionConfig } from "./node";

const formatCount = (count: number) => count.toLocaleString("en-US");

interface CollectionConfigHost {
  patchConfig(patch: Partial<CollectionConfig>): void;
}

export function bindCollection(host: CollectionConfigHost, collection: Collection | null): CollectionConfig {
  const next: CollectionConfig = collection
    ? {
        collectionId: collection.collection_id,
        collectionName: collection.name,
        collectionVersion: collection.version,
      }
    : { collectionId: null, collectionName: null, collectionVersion: null };
  host.patchConfig(next);
  return next;
}

export function CollectionBody({ host }: NodeBodyProps<CollectionConfig, CollectionCapabilities>) {
  const { data: collections, isLoading } = useCollections();
  const [bound, setBound] = useState<CollectionConfig>(() => host.config);

  if (bound.collectionId) {
    return (
      <div className="flex flex-col gap-[7px]" data-nodrag="1">
        <div className="flex items-center gap-1.5">
          <NdChip tone="amber">{bound.collectionName}</NdChip>
        </div>
        <NdCaption className="text-[9px]">emits the collection's members as a stable predicate</NdCaption>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            setBound(bindCollection(host, null));
          }}
          className="self-start cursor-pointer rounded border border-border bg-muted px-1.5 py-[3px] font-mono text-[9px] text-text-muted"
        >
          unbind
        </button>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-col gap-1 overflow-y-auto" data-nodrag="1">
      <NdHud size={8.5}>pick a collection</NdHud>
      {isLoading ? <span className="font-mono text-[9px] text-text-muted">loading…</span> : null}
      {collections?.length === 0 ? (
        <NdCaption className="text-[9px]">no collections yet — freeze a lasso and save it</NdCaption>
      ) : null}
      {collections?.map((collection) => (
        <button
          type="button"
          key={collection.collection_id}
          onClick={(event) => {
            event.stopPropagation();
            setBound(bindCollection(host, collection));
          }}
          className="flex cursor-pointer items-center gap-1.5 rounded border border-border bg-muted px-1.5 py-[3px] text-left font-mono text-[9.5px] text-muted-foreground hover:bg-surface-tertiary"
        >
          <span
            className="size-[7px] shrink-0 rounded-full"
            style={{ background: collection.color ?? "var(--color-wire-sel)" }}
          />
          <span className="min-w-0 flex-1 truncate">{collection.name}</span>
          <NdBracketed>{formatCount(collection.current_count)}</NdBracketed>
        </button>
      ))}
    </div>
  );
}
