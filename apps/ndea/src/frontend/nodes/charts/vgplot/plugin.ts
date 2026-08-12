/** vgplot plugin descriptor: eager metadata; the framework-neutral body is behind the lazy load(). */

import { defineNode, exactNodeTypeRef, nodeConfigVersion } from "@ndea/sdk";
import { VGPLOT_DEFAULT_CONFIG, vgplotConfigSchema } from "./spec-schema";

const CAPABILITIES = ["data-read", "filter-coordination"] as const;
export type VgplotCapabilities = (typeof CAPABILITIES)[number];

export const vgplotDefinition = defineNode({
  ref: exactNodeTypeRef("vgplot", "1.0.0"),
  title: "Plot",
  role: "view",
  inputs: [{ id: "in", kind: "pred", label: "In" }],
  outputs: [],
  capabilities: CAPABILITIES,
  config: {
    schema: vgplotConfigSchema,
    version: nodeConfigVersion(1),
    defaultValue: VGPLOT_DEFAULT_CONFIG,
  },
  presentation: { icon: "bar-chart" },
  documentation: {
    summary: "Draws a Mosaic vgplot chart from a plot spec.",
    use: "Pick a mark and a column, then brush the plot to select those rows.",
  },
  load: async () => {
    const { mountVgplotBody } = await import("./body");
    return {
      mountBody: (host) => mountVgplotBody(host),
    };
  },
});
