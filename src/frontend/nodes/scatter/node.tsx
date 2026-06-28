/**
 * scatter — plugin-backed view (the `scatter` descriptor renders the body via
 * BodySocket). Cooks as a pred passthrough; its lasso emission rides the push
 * port (sel), delivered downstream outside the cook. Out port is `sel`.
 */

import { defineWsNode, passthrough } from "@/core/workspace/node-kit";

export const scatterNode = defineWsNode({
  id: "scatter",
  type: "scatter",
  title: "Scatter",
  kind: "view",
  pluginId: "scatter",
  inputs: [{ id: "in", kind: "pred", label: "In" }],
  outputs: [{ id: "out", kind: "sel", label: "Selection" }],
  engineKind: "view",
  cook: (inputs) => passthrough(inputs),
  geometry: { chipW: 132, card: { w: 220, h: 156 }, full: { w: 420, h: 380 }, canFull: true },
  stage: "stageable",
  inPalette: true,
});
