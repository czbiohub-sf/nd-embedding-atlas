/** histogram plugin descriptor — eager metadata; the body is behind the lazy load(). */

import { defineDescriptor, type NodeCapability } from "@/core/node/sdk";
import type { HistogramConfig, HistogramOptions } from "./view";

declare module "@/core/node/registry-types" {
  interface NodeTypeMap {
    histogram: { config: HistogramConfig; options: HistogramOptions };
  }
}

const CAPABILITIES = new Set<NodeCapability>(["read", "selection-out", "selection-in"]);

export const histogramDescriptor = defineDescriptor<HistogramConfig, HistogramOptions>({
  id: "histogram",
  title: "Histogram",
  kind: "view",
  inputs: [{ id: "filter-in", kind: "pred", label: "Filter" }],
  outputs: [{ id: "selection-out", kind: "pred", label: "Selection" }],
  capabilities: CAPABILITIES,
  placement: { container: "docked" },
  instancePolicy: "multi",
  icon: "bar-chart",
  load: async () => {
    const { HistogramView } = await import("./view");
    return {
      Component: HistogramView,
      defaultConfig: { field: null, bins: 20 },
    };
  },
});
