/** Table plugin descriptor (PLUGIN-ARCHITECTURE §8, §10.4). */

import { z } from "zod";
import { defineNode, exactNodeTypeRef, nodeConfigVersion } from "@ndea/sdk";
import { mountReactNodeBody } from "@/core/node/react-node-body";
import type { TableConfig } from "./view";

const CAPABILITIES = ["data-read", "row-set-subscribe", "ordering-coordination", "focus-coordination"] as const;
export type TableCapabilities = (typeof CAPABILITIES)[number];

export const tableDefinition = defineNode({
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
    const { TablePluginView } = await import("./view");
    return {
      mountBody: (host) => mountReactNodeBody(TablePluginView, host, "Table"),
    };
  },
});
