/**
 * histogram — plugin-backed view node. Binned distribution of a numeric column;
 * pred in, sel out. Cooks as a predicate pass-through; its brush selection rides the
 * push port (sel), delivered downstream outside the cook (mirrors scatter).
 */

import { defineWorkspaceNodeSpec } from "@/core/workspace/node-kit";
import { passthroughGraphPredicate } from "@/core/graph/cook";

export const histogramNode = defineWorkspaceNodeSpec({
  id: "histogram",
  type: "histogram",
  title: "Histogram",
  kind: "view",
  pluginId: "histogram",
  inputs: [{ id: "in", kind: "pred", label: "In" }],
  outputs: [{ id: "out", kind: "sel", label: "Selection" }],
  evaluationRole: "view",
  cook: (inputs) => passthroughGraphPredicate(inputs),
  geometry: { chipW: 132, card: { w: 240, h: 160 }, full: { w: 380, h: 300 }, canFull: true },
  stage: "stageable",
  inPalette: true,
});
