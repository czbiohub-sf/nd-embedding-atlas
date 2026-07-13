/**
 * count — a terminal pred view: the body renders the live count of matching
 * rows. No output port (terminal) — matches the legacy WorkspaceNodeDescriptor (hasOut: false).
 */

import { CountBody } from "@/core/workspace/canvas/node-extras";
import { defineNode, exactNodeTypeRef } from "@ndea/sdk";
import { defineNativeNodeContribution } from "@/core/workspace/node-kit";
import { passthroughGraphPredicate } from "@/core/graph/cook";

const countDefinition = defineNode({
  ref: exactNodeTypeRef("count", "1.0.0"),
  title: "Count",
  role: "view",
  inputs: [{ id: "in", kind: "pred", label: "In" }],
  outputs: [],
  capabilities: [],
});

export const countNode = defineNativeNodeContribution({
  definition: countDefinition,
  graph: {
    role: "view",
    evaluationRole: "view",
    cook: (inputs) => passthroughGraphPredicate(inputs),
    Body: CountBody,
  },
  workspace: {
    geometry: { chipW: 128, card: { w: 152, h: 92 }, full: { w: 152, h: 92 }, canFull: false },
    stage: "canvas-only",
    inPalette: true,
  },
});
