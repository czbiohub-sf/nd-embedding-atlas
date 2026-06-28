/**
 * count — a terminal pred view: the body renders the live count of matching
 * rows. No output port (terminal) — matches the legacy NodeDef (hasOut: false).
 */

import { CountBody } from "@/core/workspace/canvas/node-extras";
import { defineWsNode, passthrough } from "@/core/workspace/node-kit";

export const countNode = defineWsNode({
  id: "count",
  type: "count",
  title: "Count",
  kind: "view",
  inputs: [{ id: "in", kind: "pred", label: "In" }],
  outputs: [], // terminal — no downstream wiring (legacy hasOut: false)
  engineKind: "view",
  cook: (inputs) => passthrough(inputs),
  Body: CountBody,
  geometry: { chipW: 128, card: { w: 152, h: 92 }, full: { w: 152, h: 92 }, canFull: false },
  stage: "canvas-only",
  inPalette: true,
});
