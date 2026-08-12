/** Cache: live filter/predicate passthrough until pinned by row identity. */

import { defineNode, exactNodeTypeRef } from "@ndea/sdk";

import { passthroughGraphPredicate } from "@/core/graph/cook";
import { defineNativeNodeContribution, type NativeNodeContribution } from "@/core/node/native-contribution";
import { mountReactNodeBody } from "@/core/node/react-node-body";

const cacheDefinition = defineNode({
  ref: exactNodeTypeRef("cache", "1.0.0"),
  title: "Cache",
  role: "transform",
  inputs: [{ id: "in", kind: "pred", label: "In" }],
  outputs: [{ id: "out", kind: "pred", label: "Out" }],
  capabilities: ["filter-coordination"],
  load: async () => {
    // NodeDefinition.load is the intentional lazy plugin-module boundary.
    const { CacheBody } = await import("./body");
    return { mountBody: (host) => mountReactNodeBody(CacheBody, host, "Cache") };
  },
});

const cacheCook: NativeNodeContribution["graph"]["cook"] = (inputs, host) => {
  const frozen = host.frozenPredicate();
  return frozen !== undefined ? { kind: "pred", sql: frozen } : passthroughGraphPredicate(inputs);
};

export const cacheNode = defineNativeNodeContribution({
  definition: cacheDefinition,
  graph: {
    role: "cache",
    evaluationRole: "transform",
    cook: cacheCook,
  },
  presentation: {
    geometry: { chipW: 148, card: { w: 236, h: 168 }, full: { w: 236, h: 168 }, canFull: false },
    stage: "canvas-only",
    inPalette: true,
    accent: "#f59e0b",
    checkpoint: true,
    body: "card-and-full",
  },
});
