/** count-plot plugin descriptor: eager metadata; the body is behind the lazy load(). */

import { z } from "zod";
import { defineNode, exactNodeTypeRef } from "@ndea/sdk";
import type { NodeBodyMounter } from "../../contracts";
import type { ChartServices } from "../core/contracts";
import type { CountPlotConfig } from "./types";

const CAPABILITIES = ["data-read", "filter-coordination"] as const;

export function createCountPlotDefinition({
  mountBody,
  services,
}: {
  mountBody: NodeBodyMounter;
  services: ChartServices;
}) {
  return defineNode({
    ref: exactNodeTypeRef("count-plot", "1.0.0"),
    title: "Count Plot",
    capabilities: CAPABILITIES,
    config: {
      schema: z.object({ field: z.string().nullable(), limit: z.number() }),
      defaultValue: { field: null, limit: 11 } satisfies CountPlotConfig,
    },
    presentation: { icon: "bar-chart" },
    documentation: {
      summary: "Draws a bar chart of how many rows fall in each value of a column.",
      use: "Pick a column, then click bars to filter to those values.",
    },
    load: async () => {
      const { createCountPlotView } = await import("./view");
      const CountPlotView = createCountPlotView(services);
      return {
        mountBody: (host) => mountBody(CountPlotView, host, "Count Plot"),
      };
    },
  });
}
