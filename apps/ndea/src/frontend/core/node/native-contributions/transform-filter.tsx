/** Hidden compatibility definition retained for exact persisted documents. */

import { createTransformFilterDefinition, type ThresholdFilterConfig } from "@ndea/nodes";
import { andGraphPredicate, nodeConfig } from "@/core/graph/cook";
import { defineNativeNodeContribution } from "@/core/node/native-contribution";
import { mountNodeBody } from "@/core/node/react-node-body";
import { useColumnTypes } from "@ndea/nodes/query";

export const transformFilterDefinition = createTransformFilterDefinition({
  mountBody: mountNodeBody,
  getColumnTypes: useColumnTypes,
});

export const thresholdNode = defineNativeNodeContribution({
  definition: transformFilterDefinition,
  graph: {
    role: "transform",
    evaluationRole: "transform",
    cook: (inputs, host) => {
      const { column, threshold } = nodeConfig<ThresholdFilterConfig>(host.node());
      const clause = column ? `"${column.replaceAll('"', '""')}" > ${threshold ?? 0}` : null;
      return andGraphPredicate(inputs, clause);
    },
  },
  presentation: {
    geometry: { chipW: 148, card: { w: 236, h: 124 }, full: { w: 258, h: 232 }, canFull: true },
    stage: "pin-only",
    inPalette: false,
    body: "card-and-full",
  },
});
