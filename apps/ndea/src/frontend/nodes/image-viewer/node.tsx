/**
 * Image Viewer: plugin-backed, focus-consuming view. Its cook takes the latest
 * pushed focused row. It is a sink with no output port.
 */

import { defineNativeNodeContribution } from "@/core/node/native-contribution";
import { lastPortValueOfKind } from "@/core/graph/cook";
import { imageViewerDefinition } from "./plugin";

export const imageViewerNode = defineNativeNodeContribution({
  definition: imageViewerDefinition,
  graph: {
    role: "view",
    evaluationRole: "view",
    cook: (inputs) => ({ kind: "focus", rowIndex: lastPortValueOfKind(inputs, "focus")?.rowIndex ?? null }),
  },
  presentation: {
    geometry: { chipW: 148, card: { w: 220, h: 156 }, full: { w: 440, h: 420 }, canFull: true },
    stage: "stageable",
    inPalette: true,
    body: "full-only",
  },
});
