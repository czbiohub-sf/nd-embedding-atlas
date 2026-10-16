/** Table component definition. */

import { z } from "zod";
import { defineComponent } from "@ndea/sdk";
import type { BodyMounter } from "../contracts";
import type { TableConfig } from "./contracts";

export function createTableDefinition({ mountBody }: { mountBody: BodyMounter }) {
  return defineComponent({
    type: "table",
    title: "Table",
    config: {
      schema: z.object({ columns: z.array(z.string()).nullable() }),
      defaultValue: { columns: null } satisfies TableConfig,
    },
    documentation: {
      summary: "Shows your cells as rows, one column per measurement.",
      use: "Use it to read exact values, sort, and scan the cells you selected.",
    },
    binds: ["focus", "filter", "ordering"],
    load: async () => {
      const { TableView } = await import("./view");
      return { mountBody: (host) => mountBody(TableView, host, "Table") };
    },
  });
}
