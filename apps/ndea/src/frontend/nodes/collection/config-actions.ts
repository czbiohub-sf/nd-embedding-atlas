import type { Collection } from "@ndea/protocol";

import type { CollectionConfig } from "./node";

export interface CollectionConfigHost {
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
