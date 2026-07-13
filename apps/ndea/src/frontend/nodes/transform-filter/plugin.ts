/**
 * Threshold-filter transform descriptor (node-graph tracer bullet) — the first
 * `role: "transform"` node. Metadata is eager; the per-instance runtime loads
 * lazily through the canonical SDK definition.
 */

import { z } from "zod";
import { defineNode, exactNodeTypeRef, nodeConfigVersion } from "@ndea/sdk";
import type { ThresholdFilterConfig } from "./view";

const CAPABILITIES = ["data-read", "predicate-publish", "compute"] as const;
export type TransformFilterCapabilities = (typeof CAPABILITIES)[number];

export const transformFilterDefinition = defineNode({
  ref: exactNodeTypeRef("transform-filter", "1.0.0"),
  title: "Threshold Filter",
  role: "transform",
  inputs: [{ id: "filter-in", kind: "pred", label: "In" }],
  outputs: [{ id: "out", kind: "pred", label: "Out" }],
  capabilities: CAPABILITIES,
  config: {
    schema: z.object({ column: z.string().nullable(), threshold: z.number() }),
    version: nodeConfigVersion(1),
    defaultValue: { column: null, threshold: 0 } satisfies ThresholdFilterConfig,
  },
  presentation: { icon: "filter" },
  documentation: {
    summary: "Keeps only the cells whose value clears a threshold.",
    use: "Use it to narrow the data before it flows to the next node.",
    note: "Set the column and cutoff in the node's options.",
  },
  load: async () => {
    const { createThresholdFilterRuntime } = await import("./instance");
    return {
      createRuntime: createThresholdFilterRuntime,
    };
  },
});
