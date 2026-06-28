/**
 * histogram — plugin-backed view node. Binned distribution of a numeric column;
 * pred in, sel out. Cooks as a pred passthrough; its brush selection rides the
 * push port (sel), delivered downstream outside the cook (mirrors scatter).
 */

import { defineWsNode, passthrough } from "@/core/workspace/node-kit";

export const histogramNode = defineWsNode({
  id: "histogram",
  type: "histogram",
  title: "Histogram",
  kind: "view",
  pluginId: "histogram",
  inputs: [{ id: "in", kind: "pred", label: "In" }],
  outputs: [{ id: "out", kind: "sel", label: "Selection" }],
  engineKind: "view",
  cook: (inputs) => passthrough(inputs),
  geometry: { chipW: 132, card: { w: 240, h: 160 }, full: { w: 380, h: 300 }, canFull: true },
  stage: "stageable",
  inPalette: true,
});
