/** histogram plugin descriptor: eager metadata; the body is behind the lazy load(). */

import { z } from "zod";
import { defineNode, exactNodeTypeRef, nodeConfigVersion } from "@ndea/sdk";
import type { NodeBodyMounter } from "../../contracts";
import type { ChartServices } from "../core/contracts";
import type { HistogramConfig } from "./types";

const CAPABILITIES = ["data-read", "filter-coordination"] as const;

export function createHistogramDefinition({
  mountBody,
  services,
}: {
  mountBody: NodeBodyMounter;
  services: ChartServices;
}) {
  return defineNode({
    ref: exactNodeTypeRef("histogram", "1.0.0"),
    title: "Histogram",
    role: "view",
    inputs: [{ id: "in", kind: "pred", label: "In" }],
    outputs: [],
    capabilities: CAPABILITIES,
    config: {
      schema: z.object({ field: z.string().nullable(), bins: z.number() }),
      version: nodeConfigVersion(1),
      defaultValue: { field: null, bins: 20 } satisfies HistogramConfig,
    },
    presentation: { icon: "bar-chart" },
    load: async () => {
      const { createHistogramView } = await import("./view");
      const HistogramView = createHistogramView(services);
      return {
        mountBody: (host) => mountBody(HistogramView, host, "Histogram"),
      };
    },
  });
}
