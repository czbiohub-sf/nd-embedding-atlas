/** count: a terminal predicate view showing the live number of matching rows. */

import { defineNativeNodeContribution } from "@/core/node/native-contribution";
import { mountNodeBody } from "@/core/node/react-node-body";
import { passthroughGraphPredicate } from "@/core/graph/cook";
import { predicateToSql } from "@/lib/mosaic-helpers";
import { createCountDefinition } from "@ndea/nodes/count";

const countDefinition = createCountDefinition({
  mountBody: mountNodeBody,
  predicateToSql,
});

export const countNode = defineNativeNodeContribution({
  definition: countDefinition,
  graph: {
    role: "view",
    evaluationRole: "view",
    cook: (inputs) => passthroughGraphPredicate(inputs),
  },
  presentation: {
    geometry: { chipW: 128, card: { w: 152, h: 92 }, full: { w: 152, h: 92 }, canFull: false },
    stage: "canvas-only",
    inPalette: true,
    body: "card-and-full",
  },
});
