/**
 * collection — a saved-selection source. Emits a stable members subquery; the
 * version comment busts Mosaic's SQL-text cache when the collection changes.
 * The binding (id + version) lives in the workspace, read via the cook host.
 */

import { z } from "zod";
import { defineNode, exactNodeTypeRef, nodeConfigVersion } from "@ndea/sdk";
import { CollectionNodeBody } from "@/core/workspace/canvas/node-extras";
import { defineNativeNodeContribution } from "@/core/workspace/node-kit";
import { NULL_PREDICATE_PORT_VALUE } from "@/core/graph/cook";

/** Shared by collection (bound source) and export (saved-collection sink). */
export interface CollectionConfig {
  collectionId?: string | null;
  collectionName?: string | null;
}

export const collectionConfigSchema = z.object({
  collectionId: z.string().nullable().optional(),
  collectionName: z.string().nullable().optional(),
});

const collectionDefinition = defineNode({
  ref: exactNodeTypeRef("collection", "1.0.0"),
  title: "Collection",
  role: "transform",
  inputs: [],
  outputs: [{ id: "out", kind: "pred", label: "Out" }],
  capabilities: [],
  config: {
    schema: collectionConfigSchema,
    version: nodeConfigVersion(1),
    defaultValue: {},
  },
});

export const collectionNode = defineNativeNodeContribution({
  definition: collectionDefinition,
  graph: {
    role: "source",
    evaluationRole: "source",
    cook: (_inputs, host) => {
      const b = host.collectionBinding();
      if (!b) return NULL_PREDICATE_PORT_VALUE;
      return {
        kind: "pred",
        sql: `"__obs_index__" IN (SELECT obs_index FROM collection_members WHERE collection_id = '${b.id}') /* v=${b.version} */`,
      };
    },
    Body: CollectionNodeBody,
  },
  workspace: {
    geometry: { chipW: 148, card: { w: 232, h: 150 }, full: { w: 232, h: 150 }, canFull: false },
    stage: "canvas-only",
    inPalette: true,
  },
});
