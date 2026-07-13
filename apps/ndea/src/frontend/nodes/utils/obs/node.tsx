/**
 * obs — the root source node (the whole `atlas.obs` table; no predicate).
 */

import { defineWsNode, PRED_NULL } from "@/core/workspace/node-kit";
import type { WsNode } from "@/core/workspace/types";

function ObsNodeBody(_: { node: WsNode }) {
  return (
    <div className="font-mono text-3xs text-muted-foreground">
      atlas.obs
      <br />
      <span className="text-text-muted">all rows</span>
    </div>
  );
}

export const obsNode = defineWsNode({
  id: "obs",
  type: "obs",
  title: "obs",
  kind: "source",
  inputs: [],
  outputs: [{ id: "out", kind: "pred", label: "Out" }],
  engineKind: "source",
  cook: () => PRED_NULL,
  Body: ObsNodeBody,
  geometry: { chipW: 128, card: { w: 168, h: 78 }, full: { w: 168, h: 78 }, canFull: false },
  stage: "canvas-only",
  inPalette: false,
});
