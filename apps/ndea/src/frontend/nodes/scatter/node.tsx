/**
 * scatter: plugin-backed view (the `scatter` descriptor renders the body via
 * BodySocket). Cooks as a predicate pass-through; its lasso emission rides the push
 * port (sel), delivered downstream outside the cook. Out port is `sel`.
 */

import { defineNativeNodeContribution } from "@/core/node/native-contribution";
import { passthroughGraphPredicate } from "@/core/graph/cook";
import { scatterDefinition } from "./plugin";

export const scatterNode = defineNativeNodeContribution({
  definition: scatterDefinition,
  graph: {
    role: "view",
    evaluationRole: "view",
    cook: (inputs) => passthroughGraphPredicate(inputs),
  },
  presentation: {
    geometry: { chipW: 132, card: { w: 220, h: 156 }, full: { w: 420, h: 380 }, canFull: true },
    stage: "stageable",
    inPalette: true,
    body: "full-only",
    checkpointCreation: true,
  },
});
