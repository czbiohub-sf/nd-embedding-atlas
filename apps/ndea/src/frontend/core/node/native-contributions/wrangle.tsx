/** wrangle: a PRQL-authored predicate transform. */

import { defineNativeNodeContribution } from "@/core/node/native-contribution";
import { mountNodeBody } from "@/core/node/react-node-body";
import { PrqlEditor } from "@/components/node-workspace/PrqlEditor";
import { createWrangleDefinition } from "@ndea/nodes/wrangle";
import { NATIVE_NODE_GRAPH } from "@/core/graph/native-graph";

const wrangleDefinition = createWrangleDefinition({
  mountBody: mountNodeBody,
  Editor: PrqlEditor,
});

export const wrangleNode = defineNativeNodeContribution({
  definition: wrangleDefinition,
  graph: NATIVE_NODE_GRAPH["wrangle"],
  presentation: {
    geometry: { chipW: 148, card: { w: 280, h: 168 }, full: { w: 320, h: 280 }, canFull: true },
    stage: "stageable",
    inPalette: true,
    body: "card-and-full",
  },
});
