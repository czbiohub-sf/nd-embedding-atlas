/**
 * gallery — plugin-backed view (the `gallery` descriptor renders the body).
 * Set-consuming cook: a pushed sel (lasso) takes over; else the AND of pred
 * inputs. Sink (no out port); accepts a pred or sel input.
 */

import { defineWorkspaceNodeSpec } from "@/core/workspace/node-kit";
import { lastPortValueOfKind, passthroughGraphPredicate } from "@/core/graph/cook";

export const galleryNode = defineWorkspaceNodeSpec({
  id: "gallery",
  type: "gallery",
  title: "Gallery",
  kind: "view",
  pluginId: "gallery",
  inputs: [
    { id: "in", kind: "pred", label: "In" },
    { id: "in-sel", kind: "sel", label: "In" },
  ],
  outputs: [],
  evaluationRole: "view",
  cook: (inputs) => lastPortValueOfKind(inputs, "sel") ?? passthroughGraphPredicate(inputs),
  geometry: { chipW: 132, card: { w: 220, h: 140 }, full: { w: 420, h: 360 }, canFull: true },
  stage: "stageable",
  inPalette: true,
});
