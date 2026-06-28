/**
 * wrangle — PRQL filter. The node's own compiled predicate (held in the
 * workspace's `wranglePreds`, read via the host) ANDs with the upstream pred
 * inputs. Pure pred algebra, independent of upstream cooking.
 */

import { z } from "zod";
import { WranglePane } from "@/core/workspace/canvas/WranglePane";
import { andWith, defineWsNode } from "@/core/workspace/node-kit";
import type { WsNode } from "@/core/workspace/types";

export interface WrangleConfig {
  prql?: string;
}

function WrangleBody({ node }: { node: WsNode }) {
  return <WranglePane id={node.id} />;
}

export const wrangleNode = defineWsNode({
  id: "wrangle",
  type: "wrangle",
  title: "Wrangle",
  kind: "transform",
  inputs: [{ id: "in", kind: "pred", label: "In" }],
  outputs: [{ id: "out", kind: "pred", label: "Out" }],
  config: z.object({ prql: z.string().optional() }),
  configVersion: 1,
  engineKind: "transform",
  // cook reads the COMPILED predicate (wranglePreds), not the PRQL source; the
  // config holds the source `prql` that WranglePane reads + recompiles.
  cook: (inputs, host) => andWith(inputs, host.wranglePred()),
  Body: WrangleBody,
  geometry: { chipW: 148, card: { w: 280, h: 168 }, full: { w: 320, h: 280 }, canFull: true },
  stage: "pin-only",
  inPalette: true,
});
