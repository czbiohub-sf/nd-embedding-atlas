/** export — a sink that saves an incoming row set as a server collection. */

import { defineNode, exactNodeTypeRef, nodeConfigVersion } from "@ndea/sdk";

import { consumeGraphRowSet } from "@/core/graph/cook";
import { defineNativeNodeContribution } from "@/core/node/native-contribution";
import { mountReactNodeBody } from "@/core/node/react-node-body";
import { collectionConfigSchema, type CollectionConfig } from "@/nodes/collection/node";

const CAPABILITIES = ["row-set-subscribe"] as const;
export type ExportCapabilities = (typeof CAPABILITIES)[number];

const exportDefinition = defineNode<CollectionConfig, typeof CAPABILITIES>({
  ref: exactNodeTypeRef("export", "1.0.0"),
  title: "Export",
  role: "view",
  inputs: [
    { id: "in", kind: "pred", label: "In" },
    { id: "in-sel", kind: "sel", label: "In" },
  ],
  outputs: [],
  capabilities: CAPABILITIES,
  config: {
    schema: collectionConfigSchema,
    version: nodeConfigVersion(1),
    defaultValue: { collectionId: null, collectionName: null, collectionVersion: null },
  },
  load: async () => {
    // NodeDefinition.load is the intentional lazy plugin-module boundary.
    const { ExportBody } = await import("./body");
    return { mountBody: (host) => mountReactNodeBody(ExportBody, host, "Export") };
  },
});

export const exportNode = defineNativeNodeContribution({
  definition: exportDefinition,
  graph: {
    role: "transform",
    evaluationRole: "view",
    // Preserve a pushed row set for the Body host; predicate-only input still
    // reaches the Body as a non-saveable predicate.
    cook: (inputs) => consumeGraphRowSet(inputs),
  },
  presentation: {
    geometry: { chipW: 148, card: { w: 232, h: 132 }, full: { w: 232, h: 132 }, canFull: false },
    stage: "canvas-only",
    inPalette: true,
    body: "card-and-full",
  },
});
