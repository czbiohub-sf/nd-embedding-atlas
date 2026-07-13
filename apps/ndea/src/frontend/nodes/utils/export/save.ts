import type { CollectionMutationResult, CreateCollectionBody } from "@ndea/protocol";
import type { RowIndex } from "@ndea/sdk";

import type { CollectionConfig } from "@/nodes/collection/node";

export interface ExportConfigHost {
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
