import { z } from "zod";
import { defineComponent } from "@ndea/sdk";
import type { BodyMounter } from "../contracts";
import type { ScatterConfig, ScatterServices } from "./contracts";

export function createScatterDefinition({
  mountBody,
  services,
}: {
  mountBody: BodyMounter;
  services: ScatterServices;
}) {
  return defineComponent({
    type: "scatter",
    title: "Scatter",
    config: {
      schema: z.object({ obsmKey: z.string().nullable(), colorByColumn: z.string().nullable() }),
      defaultValue: { obsmKey: null, colorByColumn: null } satisfies ScatterConfig,
    },
    documentation: {
      summary: "Plots your cells in embedding space, like a UMAP.",
      use: "Use it to spot structure, then lasso a region to select those cells.",
      note: "Pick an embedding in the component's options. Lassos publish named observation sets; linked color-by scopes share the color column.",
    },
    binds: ["focus", "filter", "colorBy", "viewSync"],
    load: async () => {
      const { createScatterView } = await import("./view");
      const ScatterView = createScatterView(services);
      return { mountBody: (host) => mountBody(ScatterView, host, "Scatter") };
    },
  });
}
