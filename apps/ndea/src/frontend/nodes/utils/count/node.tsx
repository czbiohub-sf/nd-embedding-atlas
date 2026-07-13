/**
 * count — a terminal pred view: the body renders the live count of matching
 * rows. No output port (terminal) — matches the legacy WorkspaceNodeDescriptor (hasOut: false).
 */

import { CountBody } from "@/core/workspace/canvas/node-extras";
import { defineWorkspaceNodeSpec } from "@/core/workspace/node-kit";
import { passthroughGraphPredicate } from "@/core/graph/cook";

export const countNode = defineWorkspaceNodeSpec({
  id: "count",
  type: "count",
  title: "Count",
  kind: "view",
  inputs: [{ id: "in", kind: "pred", label: "In" }],
  outputs: [], // terminal — no downstream wiring (legacy hasOut: false)
  evaluationRole: "view",
  cook: (inputs) => passthroughGraphPredicate(inputs),
  Body: CountBody,
  geometry: { chipW: 128, card: { w: 152, h: 92 }, full: { w: 152, h: 92 }, canFull: false },
  stage: "canvas-only",
  inPalette: true,
});
