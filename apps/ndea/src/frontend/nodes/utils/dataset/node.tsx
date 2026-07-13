/**
 * dataset — a per-dataset source: emits `_dataset = '<key>'`, or null (all
 * datasets) when no key is selected. The key lives in the node's config blob,
 * read live at cook time.
 */

import { z } from "zod";
import { defineNode, exactNodeTypeRef, nodeConfigVersion } from "@ndea/sdk";
import { DatasetSourceBody } from "@/core/workspace/canvas/node-extras";
import { defineNativeNodeContribution } from "@/core/workspace/node-kit";
import { nodeConfig } from "@/core/graph/cook";

export interface DatasetConfig {
  datasetKey?: string | null;
}

const datasetDefinition = defineNode({
  ref: exactNodeTypeRef("dataset", "1.0.0"),
  title: "Dataset",
  role: "transform",
  inputs: [],
  outputs: [{ id: "out", kind: "pred", label: "Out" }],
  capabilities: [],
  config: {
    schema: z.object({ datasetKey: z.string().nullable().optional() }),
    version: nodeConfigVersion(1),
    defaultValue: {},
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
    Body: DatasetSourceBody,
  },
  workspace: {
    geometry: { chipW: 148, card: { w: 196, h: 96 }, full: { w: 196, h: 96 }, canFull: false },
    stage: "canvas-only",
    inPalette: true,
  },
});
