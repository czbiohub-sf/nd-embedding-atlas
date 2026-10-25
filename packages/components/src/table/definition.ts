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
      // The toolbar's Fields and Group menus own these, so view settings hide them.
      schema: z.object({
        columns: z.array(z.string()).nullable().meta({ title: "Fields", section: "data", hidden: true }),
        groupBy: z.string().nullable().meta({ title: "Group by", section: "data", control: "column", hidden: true }),
      }),
      defaultValue: { columns: null, groupBy: null } satisfies TableConfig,
    },
    documentation: {
      summary: "Shows obs as rows, one column per field, and edits label and text fields.",
      use: "Use it to read exact values; search, filter, sort and group obs; add label or text fields and edit their cells; select rows for the filter link.",
      note: "columns lists the visible fields in order (null shows all); groupBy groups rows by a category, label or boolean field. The filter builder publishes typed clauses on the `filter` facet and a row selection publishes an observation set on the `selection` facet, both under the table's own source key. Field values are edited in the browser and saved by the user.",
    },
    binds: ["focus", "filter", "ordering"],
    load: async () => {
      const { TableView } = await import("./view");
      return { mountBody: (host) => mountBody(TableView, host, "Table") };
    },
  });
}
