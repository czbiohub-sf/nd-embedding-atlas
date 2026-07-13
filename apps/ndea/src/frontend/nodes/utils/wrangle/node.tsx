/**
 * wrangle — PRQL filter. The node's own compiled predicate (held in the
 * workspace's `wranglePreds`, read via the host) ANDs with the upstream pred
 * inputs. Pure pred algebra, independent of upstream cooking.
 */

import { z } from "zod";
import { defineNode, exactNodeTypeRef, nodeConfigVersion } from "@ndea/sdk";
import { WranglePane } from "@/core/workspace/canvas/WranglePane";
import { defineNativeNodeContribution } from "@/core/workspace/node-kit";
import { andGraphPredicate } from "@/core/graph/cook";
import type { GraphDocumentNode } from "@/core/graph/records";

export interface WrangleConfig {
  prql?: string;
}

function WrangleBody({ node }: { node: GraphDocumentNode }) {
  return <WranglePane id={node.id} />;
}

const wrangleDefinition = defineNode({
  ref: exactNodeTypeRef("wrangle", "1.0.0"),
  title: "Wrangle",
  role: "transform",
  inputs: [{ id: "in", kind: "pred", label: "In" }],
  outputs: [{ id: "out", kind: "pred", label: "Out" }],
  capabilities: [],
  config: {
    schema: z.object({ prql: z.string().optional() }),
    version: nodeConfigVersion(1),
    defaultValue: {},
  },
});

export const wrangleNode = defineNativeNodeContribution({
  definition: wrangleDefinition,
  graph: {
    role: "transform",
    evaluationRole: "transform",
    // Cook reads the compiled predicate, while config owns the PRQL source.
    cook: (inputs, host) => andGraphPredicate(inputs, host.wranglePredicate()),
    Body: WrangleBody,
  },
  workspace: {
    geometry: { chipW: 148, card: { w: 280, h: 168 }, full: { w: 320, h: 280 }, canFull: true },
    stage: "pin-only",
    inPalette: true,
  },
});
