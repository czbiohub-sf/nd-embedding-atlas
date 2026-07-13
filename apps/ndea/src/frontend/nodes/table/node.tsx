/**
 * table — plugin-backed view (the `table` descriptor renders the body). Cooks
 * as a predicate pass-through; its row focus rides the push port (focus), delivered
 * downstream outside the cook. Out port is `focus` (table row → image viewer).
 */

import { defineWorkspaceNodeSpec } from "@/core/workspace/node-kit";
import { passthroughGraphPredicate } from "@/core/graph/cook";

export const tableNode = defineWorkspaceNodeSpec({
  id: "table",
  type: "table",
  title: "Table",
  kind: "view",
  pluginId: "table",
  inputs: [{ id: "in", kind: "pred", label: "In" }],
  outputs: [{ id: "out", kind: "focus", label: "Focus" }],
  evaluationRole: "view",
  cook: (inputs) => passthroughGraphPredicate(inputs),
  geometry: { chipW: 128, card: { w: 224, h: 128 }, full: { w: 460, h: 320 }, canFull: true },
  stage: "stageable",
  inPalette: true,
});
