/**
 * count-plot — plugin-backed view node. Categorical bar chart; pred in, sel out.
 * Cooks as a predicate pass-through; its bar selection rides the push port (sel),
 * delivered downstream outside the cook (mirrors scatter).
 */

import { defineNativeNodeContribution } from "@/core/node/native-contribution";
import { passthroughGraphPredicate } from "@/core/graph/cook";
import { countPlotDefinition } from "./plugin";

export const countPlotNode = defineNativeNodeContribution({
  definition: countPlotDefinition,
  graph: {
    role: "view",
    evaluationRole: "view",
    cook: (inputs) => passthroughGraphPredicate(inputs),
  },
  presentation: {
    geometry: { chipW: 132, card: { w: 220, h: 200 }, full: { w: 360, h: 340 }, canFull: true },
    stage: "stageable",
    inPalette: true,
    body: "full-only",
  },
});
