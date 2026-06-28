/**
 * export — a sink. Wire any selection/predicate in, save its rows as a server
 * collection (the body's concern). No output port; the cook is an inert
 * pass-through so the engine has a value to register.
 */

import { ExportNodeBody } from "@/core/workspace/canvas/node-extras";
import { defineWsNode, passthrough } from "@/core/workspace/node-kit";
import { collectionConfigSchema } from "@/nodes/collection/node";

export const exportNode = defineWsNode({
  id: "export",
  type: "export",
  title: "Export",
  kind: "transform",
  // accepts a pred or sel input (only a row-bearing sel is saveable); the first
  // port is the rendered/primary handle (pred), the second widens the accept-set.
  inputs: [
    { id: "in", kind: "pred", label: "In" },
    { id: "in-sel", kind: "sel", label: "In" },
  ],
  outputs: [], // sink
  // export saves the wired rows as a collection; it stores the resulting
  // collectionId/Name (same shape as a collection node) for its body.
  config: collectionConfigSchema,
  configVersion: 1,
  engineKind: "view",
  cook: (inputs) => passthrough(inputs),
  Body: ExportNodeBody,
  geometry: { chipW: 148, card: { w: 232, h: 132 }, full: { w: 232, h: 132 }, canFull: false },
  stage: "canvas-only",
  inPalette: true,
});
