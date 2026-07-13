/**
 * export — a sink. Wire any selection/predicate in, save its rows as a server
 * collection (the body's concern). No output port; the cook is an inert
 * pass-through so the engine has a value to register.
 */

import { ExportNodeBody } from "@/core/workspace/canvas/node-extras";
import { defineNode, exactNodeTypeRef, nodeConfigVersion } from "@ndea/sdk";
import { defineNativeNodeContribution } from "@/core/workspace/node-kit";
import { passthroughGraphPredicate } from "@/core/graph/cook";
import { collectionConfigSchema } from "@/nodes/collection/node";

const exportDefinition = defineNode({
  ref: exactNodeTypeRef("export", "1.0.0"),
  title: "Export",
  role: "view",
  inputs: [
    { id: "in", kind: "pred", label: "In" },
    { id: "in-sel", kind: "sel", label: "In" },
  ],
  outputs: [],
  capabilities: [],
  config: {
    schema: collectionConfigSchema,
    version: nodeConfigVersion(1),
    defaultValue: {},
  },
});

export const exportNode = defineNativeNodeContribution({
  definition: exportDefinition,
  graph: {
    role: "transform",
    evaluationRole: "view",
    cook: (inputs) => passthroughGraphPredicate(inputs),
    Body: ExportNodeBody,
  },
  workspace: {
    geometry: { chipW: 148, card: { w: 232, h: 132 }, full: { w: 232, h: 132 }, canFull: false },
    stage: "canvas-only",
    inPalette: true,
  },
});
