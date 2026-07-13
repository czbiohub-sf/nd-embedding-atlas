/**
 * subnet — a hierarchy container. Its own cook passes input through (AND of
 * preds); the inner result reaches downstream via the hidden ⊲out→subnet edge
 * minted in `birthSubnetSeam`.
 */

import { SubnetBody } from "@/core/workspace/canvas/node-extras";
import { defineNode, exactNodeTypeRef } from "@ndea/sdk";
import { defineNativeNodeContribution } from "@/core/workspace/node-kit";
import { passthroughGraphPredicate } from "@/core/graph/cook";

const subnetDefinition = defineNode({
  ref: exactNodeTypeRef("subnet", "1.0.0"),
  title: "Subnet",
  role: "transform",
  inputs: [{ id: "in", kind: "pred", label: "In" }],
  outputs: [{ id: "out", kind: "pred", label: "Out" }],
  capabilities: [],
});

export const subnetNode = defineNativeNodeContribution({
  definition: subnetDefinition,
  graph: {
    role: "subnet",
    evaluationRole: "view",
    cook: (inputs) => passthroughGraphPredicate(inputs),
    Body: SubnetBody,
  },
  workspace: {
    geometry: { chipW: 150, card: { w: 220, h: 96 }, full: { w: 220, h: 96 }, canFull: false },
    stage: "canvas-only",
    inPalette: false,
  },
});
