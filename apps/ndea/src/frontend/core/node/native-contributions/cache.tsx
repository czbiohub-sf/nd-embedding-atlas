/** Cache: live filtered passthrough until pinned as an observation set. */

import { defineNativeNodeContribution } from "@/core/node/native-contribution";
import { mountNodeBody } from "@/core/node/react-node-body";
import { WIRE_COLOR } from "@/lib/color/brand";
import { NdIconButton } from "@/components/node-workspace/nd-icon-button";
import { createCacheDefinition } from "@ndea/nodes/cache";
import { NATIVE_NODE_GRAPH } from "@/core/graph/native-graph";

const cacheDefinition = createCacheDefinition({ mountBody: mountNodeBody, IconButton: NdIconButton });

export const cacheNode = defineNativeNodeContribution({
  definition: cacheDefinition,
  graph: NATIVE_NODE_GRAPH["cache"],
  presentation: {
    geometry: { chipW: 148, card: { w: 236, h: 168 }, full: { w: 236, h: 168 }, canFull: false },
    stage: "canvas-only",
    inPalette: true,
    accent: WIRE_COLOR.sel,
    body: "card-and-full",
  },
});
