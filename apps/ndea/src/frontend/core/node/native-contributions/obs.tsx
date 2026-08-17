/** obs: the root source node (the whole atlas.obs table; no predicate). */

import { NULL_PREDICATE_PORT_VALUE } from "@/core/graph/cook";
import { defineNativeNodeContribution } from "@/core/node/native-contribution";
import { mountNodeBody } from "@/core/node/react-node-body";
import { createBuiltinNodeDefinitions } from "@ndea/nodes";

const { obs: obsDefinition } = createBuiltinNodeDefinitions({ mountBody: mountNodeBody });

export const obsNode = defineNativeNodeContribution({
  definition: obsDefinition,
  graph: {
    role: "source",
    evaluationRole: "source",
    cook: () => NULL_PREDICATE_PORT_VALUE,
  },
  presentation: {
    geometry: { chipW: 128, card: { w: 168, h: 78 }, full: { w: 168, h: 78 }, canFull: false },
    stage: "canvas-only",
    inPalette: false,
    body: "card-and-full",
  },
});
