/**
 * fov (Idetik image viewer) — plugin-backed view (the `image-viewer` descriptor
 * renders the body). Focus-consuming cook: the latest pushed single-record
 * highlight. Sink (no out port); accepts a focus input (table row → viewer).
 */

import { defineNativeNodeContribution } from "@/core/workspace/node-kit";
import { lastPortValueOfKind } from "@/core/graph/cook";
import { imageViewerDefinition } from "./plugin";

export const fovNode = defineNativeNodeContribution({
  definition: imageViewerDefinition,
  graph: {
    persistedType: "fov",
    role: "view",
    evaluationRole: "view",
    cook: (inputs) => ({ kind: "focus", obsId: lastPortValueOfKind(inputs, "focus")?.obsId ?? null }),
    usesDefinitionModule: true,
  },
  workspace: {
    geometry: { chipW: 148, card: { w: 220, h: 156 }, full: { w: 440, h: 420 }, canFull: true },
    stage: "stageable",
    inPalette: true,
  },
});
