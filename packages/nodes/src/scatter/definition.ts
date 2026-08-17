import { z } from "zod";
import { defineNode, exactNodeTypeRef, nodeConfigVersion } from "@ndea/sdk";
import type { NodeBodyMounter } from "../contracts";
import type { ScatterConfig, ScatterServices } from "./contracts";

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

export function createScatterDefinition({
  mountBody,
  services,
}: {
  mountBody: NodeBodyMounter;
  services: ScatterServices;
}) {
  return defineNode({
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
      const { createScatterView } = await import("./view");
      const ScatterView = createScatterView(services);
      return { mountBody: (host) => mountBody(ScatterView, host, "Scatter") };
    },
  });
}
