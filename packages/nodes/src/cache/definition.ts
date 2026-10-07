import { ObservationSetIdSchema } from "@ndea/protocol";
import { defineNode, exactNodeTypeRef, nodeConfigVersion } from "@ndea/sdk";
import { z } from "zod";
import type { NodeBodyMounter } from "../contracts";
import type { CacheCapabilities, CacheConfig, CacheIconButton } from "./contracts";
import { createCacheBody } from "./body";

const CAPABILITIES = [
  "data-read",
  "filter-coordination",
  "row-set-publish",
] as const satisfies readonly CacheCapabilities[];

export function createCacheDefinition({
  mountBody,
  IconButton,
}: {
  mountBody: NodeBodyMounter;
  IconButton: CacheIconButton;
}) {
  return defineNode({
    ref: exactNodeTypeRef("cache", "1.0.0"),
    title: "Cache",
    role: "transform",
    inputs: [{ id: "in", kind: "pred", label: "In" }],
    outputs: [{ id: "out", kind: "pred", label: "Out" }],
    capabilities: CAPABILITIES,
    config: {
      schema: z.object({
        pin: z
          .object({
            clause: z.object({ op: z.literal("inSet"), set: ObservationSetIdSchema }).strict(),
            count: z.number().int().nonnegative(),
          })
          .strict()
          .nullable(),
      }),
      version: nodeConfigVersion(1),
      defaultValue: { pin: null } satisfies CacheConfig,
    },
    documentation: {
      summary: "Passes its filtered input through until pinned; a pin freezes the rows as an observation set.",
      use: "Link it to a filter scope, then cache to keep exactly those observations.",
      note: "A pin is saved in the workspace, so agents and the server see the same rows.",
    },
    load: async () => {
      // NodeDefinition.load is the intentional lazy plugin-module boundary.
      const CacheBody = createCacheBody(IconButton);
      return { mountBody: (host) => mountBody(CacheBody, host, "Cache") };
    },
  });
}
