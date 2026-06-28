/** count-plot plugin descriptor — eager metadata; the body is behind the lazy load(). */

import { defineDescriptor, type NodeCapability } from "@/core/node/sdk";
import type { CountPlotConfig, CountPlotOptions } from "./view";

declare module "@/core/node/registry-types" {
  interface NodeTypeMap {
    "count-plot": { config: CountPlotConfig; options: CountPlotOptions };
  }
}

const CAPABILITIES = new Set<NodeCapability>(["read", "selection-out", "selection-in"]);

export const countPlotDescriptor = defineDescriptor<CountPlotConfig, CountPlotOptions>({
  id: "count-plot",
  title: "Count Plot",
  kind: "view",
  inputs: [{ id: "filter-in", kind: "pred", label: "Filter" }],
  outputs: [{ id: "selection-out", kind: "pred", label: "Selection" }],
  capabilities: CAPABILITIES,
  placement: { container: "docked" },
  instancePolicy: "multi",
  icon: "bar-chart",
  load: async () => {
    const { CountPlotView } = await import("./view");
    return {
      Component: CountPlotView,
      defaultConfig: { field: null, limit: 11 },
    };
  },
});
