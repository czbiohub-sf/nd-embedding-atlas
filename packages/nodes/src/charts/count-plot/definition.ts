/** count-plot plugin descriptor: eager metadata; the body is behind the lazy load(). */

import { z } from "zod";
import { defineNode, exactNodeTypeRef, nodeConfigVersion } from "@ndea/sdk";
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
    role: "view",
    inputs: [{ id: "in", kind: "pred", label: "In" }],
    outputs: [],
    capabilities: CAPABILITIES,
    config: {
      schema: z.object({ field: z.string().nullable(), limit: z.number() }),
      version: nodeConfigVersion(1),
      defaultValue: { field: null, limit: 11 } satisfies CountPlotConfig,
    },
    presentation: { icon: "bar-chart" },
    load: async () => {
      const { createCountPlotView } = await import("./view");
      const CountPlotView = createCountPlotView(services);
      return {
        mountBody: (host) => mountBody(CountPlotView, host, "Count Plot"),
      };
    },
  });
}
