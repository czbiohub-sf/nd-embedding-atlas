/**
 * subnet: a hierarchy container. Its cook passes input through; the inner
 * result reaches downstream through the hidden subnet seam.
 */

import { defineNativeNodeContribution } from "@/core/node/native-contribution";
import { mountNodeBody } from "@/core/node/react-node-body";
import { requireAppNodeHostFacet } from "@/core/node/app-node-host";
import { NdIconButton } from "@/components/node-workspace/nd-icon-button";
import { createSubnetDefinition } from "@ndea/nodes/subnet";
import { NATIVE_NODE_GRAPH } from "@/core/graph/native-graph";

const subnetDefinition = createSubnetDefinition({
  mountBody: mountNodeBody,
  getHierarchy: (host) => requireAppNodeHostFacet(host, "hierarchy"),
  IconButton: NdIconButton,
});

export const subnetNode = defineNativeNodeContribution({
  definition: subnetDefinition,
  graph: NATIVE_NODE_GRAPH["subnet"],
  presentation: {
    geometry: { chipW: 150, card: { w: 220, h: 96 }, full: { w: 220, h: 96 }, canFull: false },
    stage: "canvas-only",
    inPalette: false,
    body: "card-and-full",
    requiredHostFacets: ["hierarchy"],
  },
});
