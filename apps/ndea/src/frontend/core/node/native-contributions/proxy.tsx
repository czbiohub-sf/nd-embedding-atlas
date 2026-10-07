/**
 * proxy: a subnet seam marker (⊳ in / ⊲ out). Chip-only, no body; passes its
 * input through so the seam relays predicates across the hierarchy boundary.
 */

import { createBuiltinNodeDefinitions } from "@ndea/nodes";
import { defineNativeNodeContribution } from "@/core/node/native-contribution";
import { mountNodeBody } from "@/core/node/react-node-body";
import { NATIVE_NODE_GRAPH } from "@/core/graph/native-graph";

// proxy declares no body, so the mounter is never reached.
const { proxy: proxyDefinition } = createBuiltinNodeDefinitions({ mountBody: mountNodeBody });

export const proxyNode = defineNativeNodeContribution({
  definition: proxyDefinition,
  graph: NATIVE_NODE_GRAPH["proxy"],
  presentation: {
    geometry: { chipW: 92, card: { w: 92, h: 28 }, full: { w: 92, h: 28 }, canFull: false },
    stage: "canvas-only",
    inPalette: false,
  },
});
