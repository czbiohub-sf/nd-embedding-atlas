/** Cache: live filter/predicate passthrough until pinned by row identity. */

import { defineNativeNodeContribution, type NativeNodeContribution } from "@/core/node/native-contribution";
import { passthroughGraphPredicate } from "@/core/graph/cook";
import { mountNodeBody } from "@/core/node/react-node-body";
import { requireAppNodeHostFacet } from "@/core/node/app-node-host";
import { WIRE_COLOR } from "@/lib/color/brand";
import { NdIconButton } from "@/components/node-workspace/nd-icon-button";
import { createCacheDefinition } from "@ndea/nodes/cache";

const cacheDefinition = createCacheDefinition({
  mountBody: mountNodeBody,
  getCheckpoint: (host) => requireAppNodeHostFacet(host, "checkpoint"),
  IconButton: NdIconButton,
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
    accent: WIRE_COLOR.sel,
    checkpoint: true,
    requiredHostFacets: ["checkpoint"],
    body: "card-and-full",
  },
});
