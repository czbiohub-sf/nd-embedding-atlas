/**
 * subnet — a hierarchy container. Its own cook passes input through (AND of
 * preds); the inner result reaches downstream via the hidden ⊲out→subnet edge
 * minted in `birthSubnetSeam`.
 */

import { SubnetBody } from "@/core/workspace/canvas/node-extras";
import { defineWsNode, passthrough } from "@/core/workspace/node-kit";

export const subnetNode = defineWsNode({
  id: "subnet",
  type: "subnet",
  title: "Subnet",
  kind: "subnet",
  inputs: [{ id: "in", kind: "pred", label: "In" }],
  outputs: [{ id: "out", kind: "pred", label: "Out" }],
  engineKind: "view",
  cook: (inputs) => passthrough(inputs),
  Body: SubnetBody,
  geometry: { chipW: 150, card: { w: 220, h: 96 }, full: { w: 220, h: 96 }, canFull: false },
  stage: "canvas-only",
  inPalette: false,
});
