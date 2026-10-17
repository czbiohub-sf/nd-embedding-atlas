/** histogram component definition: eager metadata; the body is behind the lazy load(). */

import { z } from "zod";
import { defineComponent } from "@ndea/sdk";
import type { BodyMounter } from "../../contracts";
import type { ChartServices } from "../core/contracts";
import type { HistogramConfig } from "./types";

export function createHistogramDefinition({
  mountBody,
  services,
}: {
  mountBody: BodyMounter;
  services: ChartServices;
}) {
  return defineComponent({
    type: "histogram",
    title: "Histogram",
    config: {
      schema: z.object({ field: z.string().nullable(), bins: z.number() }),
      defaultValue: { field: null, bins: 20 } satisfies HistogramConfig,
    },
    documentation: {
      summary: "Draws a histogram of a numeric column's value distribution.",
      use: "Pick a numeric column, then brush a range to filter to those rows.",
    },
    binds: ["filter"],
    load: async () => {
      const { createHistogramView } = await import("./view");
      const HistogramView = createHistogramView(services);
      return {
        mountBody: (host) => mountBody(HistogramView, host, "Histogram"),
      };
    },
  });
}
