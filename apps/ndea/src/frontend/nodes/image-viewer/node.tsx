/**
 * fov (Idetik image viewer) — plugin-backed view (the `image-viewer` descriptor
 * renders the body). Focus-consuming cook: the latest pushed single-record
 * focus. Sink (no out port); accepts a focus input (table row → viewer).
 */

import { defineNativeNodeContribution } from "@/core/node/native-contribution";
import { lastPortValueOfKind } from "@/core/graph/cook";
import { imageViewerDefinition } from "./plugin";

export const imageViewerNode = defineNativeNodeContribution({
  definition: imageViewerDefinition,
  graph: {
    persistedType: "fov",
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
