/**
 * dataset: a per-dataset source: emits `_dataset = '<key>'`, or null (all
 * datasets) when no key is selected. The key lives in the node's config blob,
 * read live at cook time.
 */

import { z } from "zod";
import { defineNode, exactNodeTypeRef, nodeConfigVersion } from "@ndea/sdk";
import { defineNativeNodeContribution } from "@/core/node/native-contribution";
import { mountReactNodeBody } from "@/core/node/react-node-body";
import { nodeConfig } from "@/core/graph/cook";

export interface DatasetConfig {
  datasetKey: string | null;
}

const CAPABILITIES = ["data-read"] as const;
export type DatasetCapabilities = (typeof CAPABILITIES)[number];

const datasetDefinition = defineNode({
  ref: exactNodeTypeRef("dataset", "1.0.0"),
  title: "Dataset",
  role: "transform",
  inputs: [],
  outputs: [{ id: "out", kind: "pred", label: "Out" }],
  capabilities: CAPABILITIES,
  config: {
    schema: z.object({ datasetKey: z.string().nullable() }),
    version: nodeConfigVersion(1),
    defaultValue: { datasetKey: null },
    migrations: [
      {
        from: nodeConfigVersion(0),
        to: nodeConfigVersion(1),
        migrate: (value) => ({
          datasetKey:
            typeof value === "object" && value !== null && !Array.isArray(value)
              ? (((value as Record<string, unknown>).datasetKey as string | null | undefined) ?? null)
              : null,
        }),
      },
    ],
  },
  load: async () => {
    // NodeDefinition.load is the intentional lazy plugin-module boundary.
    const { DatasetBody } = await import("./body");
    return { mountBody: (host) => mountReactNodeBody(DatasetBody, host, "Dataset") };
  },
});

export const datasetNode = defineNativeNodeContribution({
  definition: datasetDefinition,
  graph: {
    role: "source",
    evaluationRole: "source",
    cook: (_inputs, host) => {
      const key = nodeConfig<DatasetConfig>(host.node()).datasetKey;
      return { kind: "pred", sql: key ? `_dataset = '${key.replace(/'/g, "''")}'` : null };
    },
  },
  presentation: {
    geometry: { chipW: 148, card: { w: 196, h: 96 }, full: { w: 196, h: 96 }, canFull: false },
    stage: "canvas-only",
    inPalette: true,
    body: "card-and-full",
  },
});
