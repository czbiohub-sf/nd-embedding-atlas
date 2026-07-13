/**
 * count-plot — plugin-backed view node. Categorical bar chart; pred in, sel out.
 * Cooks as a predicate pass-through; its bar selection rides the push port (sel),
 * delivered downstream outside the cook (mirrors scatter).
 */

import { defineWorkspaceNodeSpec } from "@/core/workspace/node-kit";
import { passthroughGraphPredicate } from "@/core/graph/cook";

export const countPlotNode = defineWorkspaceNodeSpec({
  id: "count-plot",
  type: "count-plot",
  title: "Count Plot",
  kind: "view",
  pluginId: "count-plot",
  inputs: [{ id: "in", kind: "pred", label: "In" }],
  outputs: [{ id: "out", kind: "sel", label: "Selection" }],
  evaluationRole: "view",
  cook: (inputs) => passthroughGraphPredicate(inputs),
  geometry: { chipW: 132, card: { w: 220, h: 200 }, full: { w: 360, h: 340 }, canFull: true },
  stage: "stageable",
  inPalette: true,
});
