/**
 * obs — the root source node (the whole `atlas.obs` table; no predicate).
 */

import { defineWorkspaceNodeSpec } from "@/core/workspace/node-kit";
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

export const obsNode = defineWorkspaceNodeSpec({
  id: "obs",
  type: "obs",
  title: "obs",
  kind: "source",
  inputs: [],
  outputs: [{ id: "out", kind: "pred", label: "Out" }],
  evaluationRole: "source",
  cook: () => NULL_PREDICATE_PORT_VALUE,
  Body: ObsNodeBody,
  geometry: { chipW: 128, card: { w: 168, h: 78 }, full: { w: 168, h: 78 }, canFull: false },
  stage: "canvas-only",
  inPalette: false,
});
