/**
 * dataset: a per-dataset source: emits `_dataset = '<key>'`, or null (all
 * datasets) when no key is selected. The key lives in the node's config blob,
 * read live at cook time.
 */

import { defineNativeNodeContribution } from "@/core/node/native-contribution";
import { mountNodeBody } from "@/core/node/react-node-body";
import { nodeConfig } from "@/core/graph/cook";
import { createDatasetDefinition, type DatasetConfig } from "@ndea/nodes/dataset";

const datasetDefinition = createDatasetDefinition({
  mountBody: mountNodeBody,
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
