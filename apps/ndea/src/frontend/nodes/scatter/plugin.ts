/**
 * Scatter plugin descriptor (PLUGIN-ARCHITECTURE §8). Metadata is eager; the
 * Component (TypeGPU / ochre / scatter engine) is behind the lazy `load()`.
 */

import { z } from "zod";
import { defineNode, exactNodeTypeRef, nodeConfigVersion } from "@ndea/sdk";
import { mountReactNodeBody } from "@/core/node/react-node-body";
import type { ScatterConfig } from "./view";

const CAPABILITIES = [
  "data-read",
  "row-set-publish",
  "focus-coordination",
  "view-coordination",
  "filter-coordination",
  "schema-mutation",
  "gpu-device",
  "wasm-bitmap",
] as const;
export type ScatterCapabilities = (typeof CAPABILITIES)[number];

export const scatterDefinition = defineNode({
  ref: exactNodeTypeRef("scatter", "1.0.0"),
  title: "Scatter",
  role: "view",
  inputs: [{ id: "in", kind: "pred", label: "In" }],
  outputs: [],
  capabilities: CAPABILITIES,
  config: {
    schema: z.object({ obsmKey: z.string().nullable(), colorByColumn: z.string().nullable() }),
    version: nodeConfigVersion(1),
    defaultValue: { obsmKey: null, colorByColumn: null } satisfies ScatterConfig,
  },
  presentation: { icon: "scatter-chart" },
  documentation: {
    summary: "Plots your cells in embedding space, like a UMAP.",
    use: "Use it to spot structure, then lasso a region to select those cells.",
    note: "Pick which embedding to show in the node's options.",
  },
  load: async () => {
    const { ScatterPluginView } = await import("./view");
    return {
      mountBody: (host) => mountReactNodeBody(ScatterPluginView, host, "Scatter"),
    };
  },
});
