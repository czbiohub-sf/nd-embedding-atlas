/** count-plot component definition: eager metadata; the body is behind the lazy load(). */

import { z } from "zod";
import { defineComponent } from "@ndea/sdk";
import type { BodyMounter } from "../../contracts";
import type { ChartServices } from "../core/contracts";
import type { CountPlotConfig } from "./types";

export function createCountPlotDefinition({
  mountBody,
  services,
}: {
  mountBody: BodyMounter;
  services: ChartServices;
}) {
  return defineComponent({
    type: "count-plot",
    title: "Count Plot",
    config: {
      schema: z.object({
        field: z.string().nullable().meta({ title: "Field", control: "column", hidden: true }),
        limit: z.number().int().min(1).max(50).meta({ title: "Bars", section: "display" }),
      }),
      defaultValue: { field: null, limit: 11 } satisfies CountPlotConfig,
    },
    documentation: {
      summary: "Draws a bar chart of how many rows fall in each value of a column.",
      use: "Pick a column, then click bars to filter to those values.",
    },
    binds: ["filter"],
    load: async () => {
      const { createCountPlotView } = await import("./view");
      const CountPlotView = createCountPlotView(services);
      return {
        mountBody: (host) => mountBody(CountPlotView, host, "Count Plot"),
      };
    },
  });
}
