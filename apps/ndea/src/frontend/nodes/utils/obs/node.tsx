/** obs: the root source node (the whole atlas.obs table; no predicate). */

import { defineNode, exactNodeTypeRef } from "@ndea/sdk";

import { NULL_PREDICATE_PORT_VALUE } from "@/core/graph/cook";
import { defineNativeNodeContribution } from "@/core/node/native-contribution";
import { mountReactNodeBody } from "@/core/node/react-node-body";

const obsDefinition = defineNode({
  ref: exactNodeTypeRef("obs", "1.0.0"),
  title: "obs",
  role: "transform",
  inputs: [],
  outputs: [{ id: "out", kind: "pred", label: "Out" }],
  capabilities: [],
  load: async () => {
    // NodeDefinition.load is the intentional lazy plugin-module boundary.
    const { ObsBody } = await import("./body");
    return { mountBody: (host) => mountReactNodeBody(ObsBody, host, "obs") };
  },
});

export const obsNode = defineNativeNodeContribution({
  definition: obsDefinition,
  graph: {
    role: "source",
    evaluationRole: "source",
    cook: () => NULL_PREDICATE_PORT_VALUE,
  },
  presentation: {
    geometry: { chipW: 128, card: { w: 168, h: 78 }, full: { w: 168, h: 78 }, canFull: false },
    stage: "canvas-only",
    inPalette: false,
    body: "card-and-full",
  },
});
