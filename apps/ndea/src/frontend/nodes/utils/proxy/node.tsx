/**
 * proxy — a subnet seam marker (⊳ in / ⊲ out). Chip-only, no body; passes its
 * input through so the seam relays predicates across the hierarchy boundary.
 */

import { defineWorkspaceNodeSpec } from "@/core/workspace/node-kit";
import { passthroughGraphPredicate } from "@/core/graph/cook";

export const proxyNode = defineWorkspaceNodeSpec({
  id: "proxy",
  type: "proxy",
  title: "proxy",
  kind: "proxy",
  inputs: [{ id: "in", kind: "pred", label: "In" }],
  outputs: [{ id: "out", kind: "pred", label: "Out" }],
  evaluationRole: "view",
  cook: (inputs) => passthroughGraphPredicate(inputs),
  geometry: { chipW: 92, card: { w: 92, h: 28 }, full: { w: 92, h: 28 }, canFull: false },
  stage: "canvas-only",
  inPalette: false,
});
