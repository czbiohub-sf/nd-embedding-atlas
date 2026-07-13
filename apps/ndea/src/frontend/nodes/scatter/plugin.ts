/**
 * Scatter plugin descriptor (PLUGIN-ARCHITECTURE §8). Metadata is eager; the
 * Component (TypeGPU / ochre / scatter engine) is behind the lazy `load()`.
 */

import { defineDescriptor, type NodeCapability } from "@ndea/sdk";
import type { ScatterConfig, ScatterOptions } from "./view";

declare module "@/core/node/registry-types" {
  interface NodeTypeMap {
    scatter: { config: ScatterConfig; options: ScatterOptions };
  }
}

const CAPABILITIES = new Set<NodeCapability>([
  "read",
  "selection-out",
  "selection-in",
  "schema-mutate",
  "gpu",
  "wasm-bitmap",
]);

export const scatterDescriptor = defineDescriptor<ScatterConfig, ScatterOptions>({
  id: "scatter",
  title: "Scatter",
  kind: "view",
  inputs: [{ id: "filter-in", kind: "pred", label: "Filter" }],
  outputs: [{ id: "selection-out", kind: "pred", label: "Selection" }],
  capabilities: CAPABILITIES,
  placement: { container: "docked" },
  instancePolicy: "multi",
  maxInstances: 6,
  icon: "scatter-chart",
  doc: {
    summary: "Plots your cells in embedding space, like a UMAP.",
    use: "Use it to spot structure, then lasso a region to select those cells.",
    note: "Pick which embedding to show in the node's options.",
  },
  load: async () => {
    const { ScatterPluginView } = await import("./view");
    return {
      Component: ScatterPluginView,
      defaultConfig: { obsmKey: null, colorByColumn: null },
    };
  },
});
