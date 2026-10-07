/** filter: a typed Mosaic-clause predicate transform; `/api/filter` compiles the same clause. */

import { createFilterDefinition } from "@ndea/nodes/filter";
import { defineNativeNodeContribution } from "@/core/node/native-contribution";
import { mountNodeBody } from "@/core/node/react-node-body";
import { NATIVE_NODE_GRAPH } from "@/core/graph/native-graph";

export const filterNode = defineNativeNodeContribution({
  definition: createFilterDefinition({ mountBody: mountNodeBody }),
  graph: NATIVE_NODE_GRAPH["filter"],
  presentation: {
    geometry: { chipW: 148, card: { w: 280, h: 168 }, full: { w: 320, h: 280 }, canFull: true },
    stage: "stageable",
    inPalette: true,
    body: "card-and-full",
  },
});
