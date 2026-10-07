/** count: a terminal predicate view showing the live number of matching rows. */

import { defineNativeNodeContribution } from "@/core/node/native-contribution";
import { mountNodeBody } from "@/core/node/react-node-body";
import { predicateToSql } from "@/lib/mosaic-helpers";
import { createCountDefinition } from "@ndea/nodes/count";
import { NATIVE_NODE_GRAPH } from "@/core/graph/native-graph";

const countDefinition = createCountDefinition({
  mountBody: mountNodeBody,
  predicateToSql,
});

export const countNode = defineNativeNodeContribution({
  definition: countDefinition,
  graph: NATIVE_NODE_GRAPH["count"],
  presentation: {
    geometry: { chipW: 128, card: { w: 152, h: 92 }, full: { w: 152, h: 92 }, canFull: false },
    stage: "canvas-only",
    inPalette: true,
    body: "card-and-full",
  },
});
