/**
 * gallery — plugin-backed view (the `gallery` descriptor renders the body).
 * Set-consuming cook: a pushed sel (lasso) takes over; else the AND of pred
 * inputs. Sink (no out port); accepts a pred or sel input.
 */

import { defineNativeNodeContribution } from "@/core/node/native-contribution";
import { lastPortValueOfKind, passthroughGraphPredicate } from "@/core/graph/cook";
import { galleryDefinition } from "./plugin";

export const galleryNode = defineNativeNodeContribution({
  definition: galleryDefinition,
  graph: {
    role: "view",
    evaluationRole: "view",
    cook: (inputs) => lastPortValueOfKind(inputs, "sel") ?? passthroughGraphPredicate(inputs),
  },
  presentation: {
    geometry: { chipW: 132, card: { w: 220, h: 140 }, full: { w: 420, h: 360 }, canFull: true },
    stage: "stageable",
    inPalette: true,
    body: "full-only",
  },
});
