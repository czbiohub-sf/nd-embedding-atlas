/** count — a terminal predicate view showing the live number of matching rows. */

import { defineNode, exactNodeTypeRef } from "@ndea/sdk";

import { passthroughGraphPredicate } from "@/core/graph/cook";
import { defineNativeNodeContribution } from "@/core/node/native-contribution";
import { mountReactNodeBody } from "@/core/node/react-node-body";

const CAPABILITIES = ["data-read"] as const;
export type CountCapabilities = (typeof CAPABILITIES)[number];

const countDefinition = defineNode({
  ref: exactNodeTypeRef("count", "1.0.0"),
  title: "Count",
  role: "view",
  inputs: [{ id: "in", kind: "pred", label: "In" }],
  outputs: [],
  capabilities: CAPABILITIES,
  load: async () => {
    // NodeDefinition.load is the intentional lazy plugin-module boundary.
    const { CountBody } = await import("./body");
    return { mountBody: (host) => mountReactNodeBody(CountBody, host, "Count") };
  },
});

export const countNode = defineNativeNodeContribution({
  definition: countDefinition,
  graph: {
    role: "view",
    evaluationRole: "view",
    cook: (inputs) => passthroughGraphPredicate(inputs),
  },
  presentation: {
    geometry: { chipW: 128, card: { w: 152, h: 92 }, full: { w: 152, h: 92 }, canFull: false },
    stage: "canvas-only",
    inPalette: true,
    body: "card-and-full",
  },
});
