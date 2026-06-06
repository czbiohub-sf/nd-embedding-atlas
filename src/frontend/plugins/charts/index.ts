/** Charts plugin descriptor (PLUGIN-ARCHITECTURE §8, §10.3). */

import type { PluginCapability, PluginDescriptor } from "@/core/plugin/types";
import type { ChartsConfig, ChartsOptions } from "./ChartsPluginView";

declare module "@/core/plugin/registry-types" {
  interface PluginTypeMap {
    charts: { config: ChartsConfig; options: ChartsOptions };
  }
}

const CAPABILITIES = new Set<PluginCapability>(["read", "selection-out", "selection-in"]);

export const chartsDescriptor: PluginDescriptor<ChartsConfig, ChartsOptions> = {
  id: "charts",
  title: "Charts",
  kind: "view",
  inputs: [{ id: "filter-in", kind: "selection", label: "Filter" }],
  outputs: [{ id: "selection-out", kind: "selection", label: "Selection" }],
  capabilities: CAPABILITIES,
  placement: { container: "docked" },
  instancePolicy: "unique-per-container",
  icon: "bar-chart",
  load: async () => {
    const { ChartsPluginView } = await import("./ChartsPluginView");
    return {
      Component: ChartsPluginView,
      defaultConfig: { specs: null },
    };
  },
};
