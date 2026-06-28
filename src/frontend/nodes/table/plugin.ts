/** Table plugin descriptor (PLUGIN-ARCHITECTURE §8, §10.4). */

import { defineDescriptor, type NodeCapability } from "@/core/node/sdk";
import type { TableConfig, TableOptions } from "./view";

declare module "@/core/node/registry-types" {
  interface NodeTypeMap {
    table: { config: TableConfig; options: TableOptions };
  }
}

const CAPABILITIES = new Set<NodeCapability>(["read", "selection-in", "ordering"]);

export const tableDescriptor = defineDescriptor<TableConfig, TableOptions>({
  id: "table",
  title: "Table",
  kind: "view",
  inputs: [{ id: "filter-in", kind: "pred", label: "Filter" }],
  outputs: [],
  capabilities: CAPABILITIES,
  placement: { container: "docked", side: "bottom" },
  instancePolicy: "unique-per-container",
  icon: "table",
  load: async () => {
    const { TablePluginView } = await import("./view");
    return {
      Component: TablePluginView,
      defaultConfig: { columns: null },
    };
  },
});
