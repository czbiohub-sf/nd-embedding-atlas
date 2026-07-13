/**
 * proxy — a subnet seam marker (⊳ in / ⊲ out). Chip-only, no body; passes its
 * input through so the seam relays predicates across the hierarchy boundary.
 */

import { defineNode, exactNodeTypeRef } from "@ndea/sdk";
import { defineNativeNodeContribution } from "@/core/workspace/node-kit";
import { passthroughGraphPredicate } from "@/core/graph/cook";

const proxyDefinition = defineNode({
  ref: exactNodeTypeRef("proxy", "1.0.0"),
  title: "proxy",
  role: "transform",
  inputs: [{ id: "in", kind: "pred", label: "In" }],
  outputs: [{ id: "out", kind: "pred", label: "Out" }],
  capabilities: [],
});

export const proxyNode = defineNativeNodeContribution({
  definition: proxyDefinition,
  graph: {
    role: "proxy",
    evaluationRole: "view",
    cook: (inputs) => passthroughGraphPredicate(inputs),
  },
  workspace: {
    geometry: { chipW: 92, card: { w: 92, h: 28 }, full: { w: 92, h: 28 }, canFull: false },
    stage: "canvas-only",
    inPalette: false,
  },
});
