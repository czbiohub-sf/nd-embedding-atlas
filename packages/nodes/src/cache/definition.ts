import { defineNode, exactNodeTypeRef } from "@ndea/sdk";
import type { NodeBodyMounter } from "../contracts";
import type { CacheCapabilities, CacheCheckpointResolver, CacheIconButton } from "./contracts";
import { createCacheBody } from "./body";

export function createCacheDefinition({
  mountBody,
  getCheckpoint,
  IconButton,
}: {
  mountBody: NodeBodyMounter;
  getCheckpoint: CacheCheckpointResolver;
  IconButton: CacheIconButton;
}) {
  return defineNode({
    ref: exactNodeTypeRef("cache", "1.0.0"),
    title: "Cache",
    role: "transform",
    inputs: [{ id: "in", kind: "pred", label: "In" }],
    outputs: [{ id: "out", kind: "pred", label: "Out" }],
    capabilities: ["filter-coordination"] satisfies readonly CacheCapabilities[],
    load: async () => {
      // NodeDefinition.load is the intentional lazy plugin-module boundary.
      const CacheBody = createCacheBody(getCheckpoint, IconButton);
      return { mountBody: (host) => mountBody(CacheBody, host, "Cache") };
    },
  });
}
