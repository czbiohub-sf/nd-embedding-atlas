/**
 * vgplot: plugin-backed view node. Renders a Mosaic vgplot spec against the app
 * Coordinator; pred in, sel out. Cooks as a predicate pass-through; its brush
 * selection rides the push port (sel), delivered downstream outside the cook
 * (mirrors histogram). Palette entry is editor-gated while the node is a spike:
 * it stays registered in production so saved documents keep resolving.
 */

import { createVgplotDefinition } from "@ndea/nodes";
import { defineNativeNodeContribution } from "@/core/node/native-contribution";
import { NODE_EDITOR_ENABLED } from "@/feature-flags";
import { NATIVE_NODE_GRAPH } from "@/core/graph/native-graph";

export const vgplotDefinition = createVgplotDefinition();

export const vgplotNode = defineNativeNodeContribution({
  definition: vgplotDefinition,
  graph: NATIVE_NODE_GRAPH["vgplot"],
  presentation: {
    geometry: { chipW: 132, card: { w: 240, h: 160 }, full: { w: 380, h: 300 }, canFull: true },
    stage: "stageable",
    inPalette: NODE_EDITOR_ENABLED,
    body: "full-only",
  },
});
