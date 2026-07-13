/**
 * collection — a saved-selection source. Emits a stable members subquery; the
 * version comment busts Mosaic's SQL-text cache when the collection changes.
 * The binding (id + version) lives in the workspace, read via the cook host.
 */

import { z } from "zod";
import { CollectionNodeBody } from "@/core/workspace/canvas/node-extras";
import { defineWsNode, PRED_NULL } from "@/core/workspace/node-kit";

/** Shared by collection (bound source) and export (saved-collection sink). */
export interface CollectionConfig {
  collectionId?: string | null;
  collectionName?: string | null;
}

export const collectionConfigSchema = z.object({
  collectionId: z.string().nullable().optional(),
  collectionName: z.string().nullable().optional(),
});

export const collectionNode = defineWsNode({
  id: "collection",
  type: "collection",
  title: "Collection",
  kind: "source",
  inputs: [],
  outputs: [{ id: "out", kind: "pred", label: "Out" }],
  config: collectionConfigSchema,
  configVersion: 1,
  engineKind: "source",
  cook: (_inputs, host) => {
    const b = host.collectionBinding();
    if (!b) return PRED_NULL;
    return {
      kind: "pred",
      sql: `"__obs_index__" IN (SELECT obs_index FROM collection_members WHERE collection_id = '${b.id}') /* v=${b.version} */`,
    };
  },
  Body: CollectionNodeBody,
  geometry: { chipW: 148, card: { w: 232, h: 150 }, full: { w: 232, h: 150 }, canFull: false },
  stage: "canvas-only",
  inPalette: true,
});
