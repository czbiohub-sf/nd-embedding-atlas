/**
 * histogram — plugin-backed view node. Binned distribution of a numeric column;
 * pred in, sel out. Cooks as a predicate pass-through; its brush selection rides the
 * push port (sel), delivered downstream outside the cook (mirrors scatter).
 */

import { defineNativeNodeContribution } from "@/core/workspace/node-kit";
import { passthroughGraphPredicate } from "@/core/graph/cook";
import { histogramDefinition } from "./plugin";

export const histogramNode = defineNativeNodeContribution({
  definition: histogramDefinition,
  graph: {
    role: "view",
    evaluationRole: "view",
    cook: (inputs) => passthroughGraphPredicate(inputs),
    usesDefinitionModule: true,
  },
  workspace: {
    geometry: { chipW: 132, card: { w: 240, h: 160 }, full: { w: 380, h: 300 }, canFull: true },
    stage: "stageable",
    inPalette: true,
  },
});
