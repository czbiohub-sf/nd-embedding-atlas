/** histogram plugin descriptor: eager metadata; the body is behind the lazy load(). */

import { z } from "zod";
import { defineNode, exactNodeTypeRef, nodeConfigVersion } from "@ndea/sdk";
import { mountReactNodeBody } from "@/core/node/react-node-body";
import type { HistogramConfig } from "./view";

const CAPABILITIES = ["data-read", "filter-coordination"] as const;
export type HistogramCapabilities = (typeof CAPABILITIES)[number];

export const histogramDefinition = defineNode({
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
    const { HistogramView } = await import("./view");
    return {
      mountBody: (host) => mountReactNodeBody(HistogramView, host, "Histogram"),
    };
  },
});
