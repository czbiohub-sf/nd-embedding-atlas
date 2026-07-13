/**
 * fov (Idetik image viewer) — plugin-backed view (the `image-viewer` descriptor
 * renders the body). Focus-consuming cook: the latest pushed single-record
 * highlight. Sink (no out port); accepts a focus input (table row → viewer).
 */

import { defineWsNode, lastOfKind } from "@/core/workspace/node-kit";

export const fovNode = defineWsNode({
  id: "fov",
  type: "fov",
  title: "Idetik",
  kind: "view",
  pluginId: "image-viewer",
  inputs: [{ id: "in", kind: "focus", label: "Highlight" }],
  outputs: [],
  engineKind: "view",
  cook: (inputs) => ({ kind: "focus", obsId: lastOfKind(inputs, "focus")?.obsId ?? null }),
  geometry: { chipW: 148, card: { w: 220, h: 156 }, full: { w: 440, h: 420 }, canFull: true },
  stage: "stageable",
  inPalette: true,
});
