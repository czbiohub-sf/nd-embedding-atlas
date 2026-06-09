/** Table plugin descriptor (PLUGIN-ARCHITECTURE §8, §10.4). */

import type { PluginCapability, PluginDescriptor } from "@/core/plugin/types";
import type { TableConfig, TableOptions } from "./TablePluginView";

declare module "@/core/plugin/registry-types" {
  interface PluginTypeMap {
    table: { config: TableConfig; options: TableOptions };
  }
}

const CAPABILITIES = new Set<PluginCapability>(["read", "selection-in"]);

export const tableDescriptor: PluginDescriptor<TableConfig, TableOptions> = {
  id: "table",
  title: "Table",
  kind: "view",
  inputs: [{ id: "filter-in", kind: "selection", label: "Filter" }],
  outputs: [],
  capabilities: CAPABILITIES,
  placement: { container: "docked", side: "bottom" },
  instancePolicy: "unique-per-container",
  icon: "table",
  load: async () => {
    const { TablePluginView } = await import("./TablePluginView");
    return {
      Component: TablePluginView,
      defaultConfig: { columns: null },
    };
  },
};
