/** collection — a saved row-set source backed by durable collection members. */

import { defineNode, exactNodeTypeRef, nodeConfigVersion } from "@ndea/sdk";
import { z } from "zod";

import { nodeConfig, NULL_PREDICATE_PORT_VALUE } from "@/core/graph/cook";
import { defineNativeNodeContribution } from "@/core/node/native-contribution";
import { mountReactNodeBody } from "@/core/node/react-node-body";

export interface CollectionConfig {
  collectionId?: string | null;
  collectionName?: string | null;
  collectionVersion?: number | null;
}

export const collectionConfigSchema = z.object({
  collectionId: z.string().nullable().optional(),
  collectionName: z.string().nullable().optional(),
  collectionVersion: z.number().int().nonnegative().nullable().optional(),
});

const CAPABILITIES = ["collection-read"] as const;
export type CollectionCapabilities = (typeof CAPABILITIES)[number];

const collectionDefinition = defineNode({
  ref: exactNodeTypeRef("collection", "1.0.0"),
  title: "Collection",
  role: "transform",
  inputs: [],
  outputs: [{ id: "out", kind: "pred", label: "Out" }],
  capabilities: CAPABILITIES,
  config: {
    schema: collectionConfigSchema,
    version: nodeConfigVersion(1),
    defaultValue: {},
  },
  load: async () => {
    // NodeDefinition.load is the intentional lazy plugin-module boundary.
    const { CollectionBody } = await import("./body");
    return { mountBody: (host) => mountReactNodeBody(CollectionBody, host, "Collection") };
  },
});

export const collectionNode = defineNativeNodeContribution({
  definition: collectionDefinition,
  graph: {
    role: "source",
    evaluationRole: "source",
    cook: (_inputs, host) => {
      const binding = nodeConfig<CollectionConfig>(host.node());
      if (!binding.collectionId) return NULL_PREDICATE_PORT_VALUE;
      const collectionId = binding.collectionId.replace(/'/g, "''");
      return {
        kind: "pred",
        sql: `"__obs_index__" IN (SELECT obs_index FROM collection_members WHERE collection_id = '${collectionId}') /* v=${binding.collectionVersion ?? 0} */`,
      };
    },
  },
  presentation: {
    geometry: { chipW: 148, card: { w: 232, h: 150 }, full: { w: 232, h: 150 }, canFull: false },
    stage: "canvas-only",
    inPalette: true,
    body: "card-and-full",
  },
});
