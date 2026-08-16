/** Table plugin descriptor (PLUGIN-ARCHITECTURE §8, §10.4). */

import { z } from "zod";
import { defineNode, exactNodeTypeRef, nodeConfigVersion } from "@ndea/sdk";
import type { NodeBodyMounter } from "../contracts";
import type { TableConfig, TableServices } from "./contracts";

const CAPABILITIES = ["data-read", "filter-coordination", "ordering-coordination", "focus-coordination"] as const;

export function createTableDefinition({
  mountBody,
  services,
}: {
  mountBody: NodeBodyMounter;
  services: TableServices;
}) {
  return defineNode({
    ref: exactNodeTypeRef("table", "1.0.0"),
    title: "Table",
    role: "view",
    inputs: [{ id: "in", kind: "pred", label: "In" }],
    outputs: [{ id: "out", kind: "focus", label: "Focus" }],
    capabilities: CAPABILITIES,
    config: {
      schema: z.object({ columns: z.array(z.string()).nullable() }),
      version: nodeConfigVersion(1),
      defaultValue: { columns: null } satisfies TableConfig,
    },
    presentation: { icon: "table" },
    documentation: {
      summary: "Shows your cells as rows, one column per measurement.",
      use: "Use it to read exact values, sort, and scan the cells you selected.",
    },
    load: async () => {
      const { createTablePluginView } = await import("./view");
      const TablePluginView = createTablePluginView(services);
      return { mountBody: (host) => mountBody(TablePluginView, host, "Table") };
    },
  });
}
