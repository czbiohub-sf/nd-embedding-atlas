/** count-plot plugin descriptor — eager metadata; the body is behind the lazy load(). */

import { z } from "zod";
import { defineNode, exactNodeTypeRef, nodeConfigVersion } from "@ndea/sdk";
import { mountReactNodeBody } from "@/core/node/react-node-body";
import type { CountPlotConfig } from "./view";

const CAPABILITIES = ["data-read", "predicate-publish", "row-set-subscribe"] as const;
export type CountPlotCapabilities = (typeof CAPABILITIES)[number];

export const countPlotDefinition = defineNode({
  ref: exactNodeTypeRef("count-plot", "1.0.0"),
  title: "Count Plot",
  role: "view",
  inputs: [{ id: "in", kind: "pred", label: "In" }],
  outputs: [{ id: "out", kind: "sel", label: "Selection" }],
  capabilities: CAPABILITIES,
  config: {
    schema: z.object({ field: z.string().nullable(), limit: z.number() }),
    version: nodeConfigVersion(1),
    defaultValue: { field: null, limit: 11 } satisfies CountPlotConfig,
  },
  presentation: { icon: "bar-chart" },
  load: async () => {
    const { CountPlotView } = await import("./view");
    return {
      mountBody: (host) => mountReactNodeBody(CountPlotView, host, "Count Plot"),
    };
  },
});
