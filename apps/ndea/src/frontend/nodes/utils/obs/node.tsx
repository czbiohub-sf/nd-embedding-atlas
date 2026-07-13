/**
 * obs — the root source node (the whole `atlas.obs` table; no predicate).
 */

import { defineNode, exactNodeTypeRef } from "@ndea/sdk";
import { defineNativeNodeContribution } from "@/core/workspace/node-kit";
import { NULL_PREDICATE_PORT_VALUE } from "@/core/graph/cook";
import type { GraphDocumentNode } from "@/core/graph/records";

function ObsNodeBody(_: { node: GraphDocumentNode }) {
  return (
    <div className="font-mono text-3xs text-muted-foreground">
      atlas.obs
      <br />
      <span className="text-text-muted">all rows</span>
    </div>
  );
}

const obsDefinition = defineNode({
  ref: exactNodeTypeRef("obs", "1.0.0"),
  title: "obs",
  role: "transform",
  inputs: [],
  outputs: [{ id: "out", kind: "pred", label: "Out" }],
  capabilities: [],
});

export const obsNode = defineNativeNodeContribution({
  definition: obsDefinition,
  graph: {
    role: "source",
    evaluationRole: "source",
    cook: () => NULL_PREDICATE_PORT_VALUE,
    Body: ObsNodeBody,
  },
  workspace: {
    geometry: { chipW: 128, card: { w: 168, h: 78 }, full: { w: 168, h: 78 }, canFull: false },
    stage: "canvas-only",
    inPalette: false,
  },
});
