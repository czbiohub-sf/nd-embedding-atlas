/**
 * table — plugin-backed view (the `table` descriptor renders the body). Cooks
 * as a predicate pass-through; its row focus rides the push port (focus), delivered
 * downstream outside the cook. Out port is `focus` (table row → image viewer).
 */

import { defineNativeNodeContribution } from "@/core/node/native-contribution";
import { passthroughGraphPredicate } from "@/core/graph/cook";
import { tableDefinition } from "./plugin";

export const tableNode = defineNativeNodeContribution({
  definition: tableDefinition,
  graph: {
    role: "view",
    evaluationRole: "view",
    cook: (inputs) => passthroughGraphPredicate(inputs),
  },
  presentation: {
    geometry: { chipW: 128, card: { w: 224, h: 128 }, full: { w: 460, h: 320 }, canFull: true },
    stage: "stageable",
    inPalette: true,
    body: "full-only",
  },
});
