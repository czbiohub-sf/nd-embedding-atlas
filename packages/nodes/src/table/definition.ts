/** Table plugin descriptor (PLUGIN-ARCHITECTURE §8, §10.4). */

import { createElement } from "react";
import { z } from "zod";
import { defineNode, exactNodeTypeRef, nodeConfigVersion } from "@ndea/sdk";
import type { NodeBodyMounter } from "../contracts";
import type { NodeBodyProps, TableCapabilities, TableConfig, TableServices } from "./contracts";

const CAPABILITIES = ["data-read", "filter-coordination", "ordering-coordination", "focus-coordination"] as const;

export function createTableDefinition({
  mountBody,
  useServices,
}: {
  mountBody: NodeBodyMounter;
  /**
   * A hook, not a value: the row-detail crop reads live viewer channels and Z,
   * so the body must re-render when those stores change. This mirrors the
   * annotate node, which needs the same two services for the same reason.
   */
  useServices: () => TableServices;
}) {
  return defineNode({
    ref: exactNodeTypeRef("table", "1.0.0"),
    title: "Table",
    role: "view",
    inputs: [{ id: "in", kind: "pred", label: "In" }],
    outputs: [{ id: "out", kind: "focus", label: "Focus" }],
    capabilities: CAPABILITIES,
    config: {
      schema: z.object({
        columns: z.array(z.string()).nullable(),
        groupBy: z.string().nullable().optional(),
      }),
      version: nodeConfigVersion(1),
      defaultValue: { columns: null, groupBy: null } satisfies TableConfig,
    },
    presentation: { icon: "table" },
    documentation: {
      summary: "Shows your cells as rows, one column per measurement.",
      use: "Use it to read exact values, sort, and scan the cells you selected.",
    },
    load: async () => {
      const { TableView } = await import("./view");
      function ConfiguredTableView(props: NodeBodyProps<TableConfig, TableCapabilities>) {
        return createElement(TableView, { ...props, services: useServices() });
      }
      return { mountBody: (host) => mountBody(ConfiguredTableView, host, "Table") };
    },
  });
}
