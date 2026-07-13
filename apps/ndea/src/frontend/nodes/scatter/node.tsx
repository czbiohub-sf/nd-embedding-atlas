/**
 * scatter — plugin-backed view (the `scatter` descriptor renders the body via
 * BodySocket). Cooks as a predicate pass-through; its lasso emission rides the push
 * port (sel), delivered downstream outside the cook. Out port is `sel`.
 */

import { defineWorkspaceNodeSpec } from "@/core/workspace/node-kit";
import { passthroughGraphPredicate } from "@/core/graph/cook";

export const scatterNode = defineWorkspaceNodeSpec({
  id: "scatter",
  type: "scatter",
  title: "Scatter",
  kind: "view",
  pluginId: "scatter",
  inputs: [{ id: "in", kind: "pred", label: "In" }],
  outputs: [{ id: "out", kind: "sel", label: "Selection" }],
  evaluationRole: "view",
  cook: (inputs) => passthroughGraphPredicate(inputs),
  geometry: { chipW: 132, card: { w: 220, h: 156 }, full: { w: 420, h: 380 }, canFull: true },
  stage: "stageable",
  inPalette: true,
});
