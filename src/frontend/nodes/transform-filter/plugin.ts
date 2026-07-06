/**
 * Threshold-filter transform descriptor (node-graph tracer bullet) — the first
 * `kind: "transform"` plugin. Metadata is eager; the editor Component +
 * `createInstance` (recompute) load lazily. Authored via the SDK `defineDescriptor`.
 */

import { defineDescriptor, type NodeCapability } from "@/core/node/sdk";
import type { ThresholdFilterConfig, ThresholdFilterOptions } from "./view";

declare module "@/core/node/registry-types" {
  interface NodeTypeMap {
    "transform-filter": { config: ThresholdFilterConfig; options: ThresholdFilterOptions };
  }
}

const CAPABILITIES = new Set<NodeCapability>(["read"]);

export const transformFilterDescriptor = defineDescriptor<ThresholdFilterConfig, ThresholdFilterOptions>({
  id: "transform-filter",
  title: "Threshold Filter",
  kind: "transform",
  inputs: [{ id: "filter-in", kind: "pred", label: "In" }],
  outputs: [{ id: "out", kind: "pred", label: "Out" }],
  capabilities: CAPABILITIES,
  placement: { container: "docked" },
  instancePolicy: "multi",
  icon: "filter",
  doc: {
    summary: "Keeps only the cells whose value clears a threshold.",
    use: "Use it to narrow the data before it flows to the next node.",
    note: "Set the column and cutoff in the node's options.",
  },
  load: async () => {
    const [{ ThresholdFilterView }, { createThresholdFilterInstance }] = await Promise.all([
      import("./view"),
      import("./instance"),
    ]);
    return {
      Component: ThresholdFilterView,
      defaultConfig: { column: null, threshold: 0 },
      createInstance: createThresholdFilterInstance,
    };
  },
});
