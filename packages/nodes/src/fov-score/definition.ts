/** fov-score plugin descriptor: eager metadata; the body is behind the lazy load(). */

import { z } from "zod";
import { defineNode, exactNodeTypeRef, nodeConfigVersion } from "@ndea/sdk";
import type { NodeBodyMounter } from "../contracts";
import type { FovScoreConfig } from "./contracts";
import { AGGREGATIONS, DIRECTIONS, SHAPES } from "./desirability";

/**
 * `data-read` plus `focus-coordination`. No `annotation-write`: this node tunes and exports,
 * it does not label -- that is fov-label's job, and the two must stay separable so a config
 * can be tuned against labels somebody else made. Focus is read-only here: the node follows
 * a FOV picked in the scatter or the plate grid, and marks where it sits on every feature.
 */
const CAPABILITIES = ["data-read", "focus-coordination"] as const;

const featureSpecSchema = z.object({
  shape: z.enum(SHAPES),
  direction: z.enum(DIRECTIONS),
  /** Keys differ per shape, so this cannot be a fixed object. `defaults.ts` keeps them valid. */
  params: z.record(z.string(), z.number()),
  weight: z.number(),
  enabled: z.boolean(),
});

export function createFovScoreDefinition({ mountBody }: { mountBody: NodeBodyMounter }) {
  return defineNode({
    ref: exactNodeTypeRef("fov-score", "1.0.0"),
    title: "FOV Score",
    role: "view",
    inputs: [{ id: "in", kind: "pred", label: "In" }],
    outputs: [],
    capabilities: CAPABILITIES,
    config: {
      schema: z.object({
        features: z.record(z.string(), featureSpecSchema).default({}),
        aggregation: z.enum(AGGREGATIONS).nullable().default(null),
        topFov: z.number().nullable().default(null),
        bins: z.number().nullable().default(null),
        plotPx: z.number().nullable().default(null),
        pane: z.enum(["table", "yaml", "none"]).nullable().default(null),
      }),
      version: nodeConfigVersion(1),
      defaultValue: {
        features: {},
        aggregation: null,
        topFov: null,
        bins: null,
        plotPx: null,
        pane: null,
      } satisfies FovScoreConfig,
    },
    presentation: { icon: "sliders" },
    load: async () => {
      const { FovScoreView } = await import("./view");
      return { mountBody: (host) => mountBody(FovScoreView, host, "FOV Score") };
    },
  });
}
