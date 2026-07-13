/** Retired Threshold Filter retained for persisted v2 documents. */

import { andGraphPredicate, nodeConfig } from "@/core/graph/cook";
import { defineNativeNodeContribution } from "@/core/node/native-contribution";
import { transformFilterDefinition } from "@/nodes/transform-filter/plugin";
import type { ThresholdFilterConfig } from "@/nodes/transform-filter/view";

export const thresholdNode = defineNativeNodeContribution({
  definition: transformFilterDefinition,
  graph: {
    persistedType: "threshold",
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
