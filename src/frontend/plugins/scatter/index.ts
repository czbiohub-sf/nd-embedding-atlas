/**
 * Scatter plugin descriptor (PLUGIN-ARCHITECTURE §8). Metadata is eager; the
 * Component (TypeGPU / ochre / scatter engine) is behind the lazy `load()`.
 */

import type { PluginCapability, PluginDescriptor } from "@/core/plugin/types";
import type { ScatterConfig, ScatterOptions } from "./ScatterPluginView";

declare module "@/core/plugin/registry-types" {
  interface PluginTypeMap {
    scatter: { config: ScatterConfig; options: ScatterOptions };
  }
}

const CAPABILITIES = new Set<PluginCapability>([
  "read",
  "selection-out",
  "selection-in",
  "schema-mutate",
  "gpu",
  "wasm-bitmap",
]);

export const scatterDescriptor: PluginDescriptor<ScatterConfig, ScatterOptions> = {
  id: "scatter",
  title: "Scatter",
  kind: "view",
  inputs: [{ id: "filter-in", kind: "selection", label: "Filter" }],
  outputs: [{ id: "selection-out", kind: "selection", label: "Selection" }],
  capabilities: CAPABILITIES,
  placement: { container: "docked" },
  instancePolicy: "multi",
  maxInstances: 6,
  icon: "scatter-chart",
  load: async () => {
    const { ScatterPluginView } = await import("./ScatterPluginView");
    return {
      Component: ScatterPluginView,
      defaultConfig: { obsmKey: null, colorByColumn: null },
    };
  },
};
