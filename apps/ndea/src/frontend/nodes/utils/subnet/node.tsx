/**
 * subnet — a hierarchy container. Its cook passes input through; the inner
 * result reaches downstream through the hidden subnet seam.
 */

import { defineNode, exactNodeTypeRef } from "@ndea/sdk";

import { passthroughGraphPredicate } from "@/core/graph/cook";
import { defineNativeNodeContribution } from "@/core/node/native-contribution";
import { mountReactNodeBody } from "@/core/node/react-node-body";

const subnetDefinition = defineNode({
  ref: exactNodeTypeRef("subnet", "1.0.0"),
  title: "Subnet",
  role: "transform",
  inputs: [{ id: "in", kind: "pred", label: "In" }],
  outputs: [{ id: "out", kind: "pred", label: "Out" }],
  capabilities: [],
  load: async () => {
    // NodeDefinition.load is the intentional lazy plugin-module boundary.
    const { SubnetBody } = await import("./body");
    return { mountBody: (host) => mountReactNodeBody(SubnetBody, host, "Subnet") };
  },
});

export const subnetNode = defineNativeNodeContribution({
  definition: subnetDefinition,
  graph: {
    role: "subnet",
    evaluationRole: "view",
    cook: (inputs) => passthroughGraphPredicate(inputs),
  },
  presentation: {
    geometry: { chipW: 150, card: { w: 220, h: 96 }, full: { w: 220, h: 96 }, canFull: false },
    stage: "canvas-only",
    inPalette: false,
    body: "card-and-full",
  },
});
