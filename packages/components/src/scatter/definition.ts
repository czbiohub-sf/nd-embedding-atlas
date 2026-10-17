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
      schema: z.object({
        obsmKey: z.string().nullable(),
        colorByColumn: z.string().nullable(),
        zDim: z
          .number()
          .int()
          .nonnegative()
          .nullable()
          .describe(
            "3D: the embedding dimension on the z axis (x and y are dims 0 and 1; the embedding needs more columns than zDim). null = 2D.",
          ),
      }),
      defaultValue: { obsmKey: null, colorByColumn: null, zDim: null } satisfies ScatterConfig,
    },
    documentation: {
      summary: "Plots your cells in embedding space, like a UMAP.",
      use: "Use it to spot structure, then lasso a region to select those cells.",
      note: "Pick an embedding in the component's options. Set zDim (e.g. 2) for a 3D view of an embedding with 3+ columns. Lassos publish named observation sets; linked color-by scopes share the color column.",
    },
    binds: ["focus", "filter", "colorBy", "viewSync"],
    load: async () => {
      const { createScatterView } = await import("./view");
      const ScatterView = createScatterView(services);
      return { mountBody: (host) => mountBody(ScatterView, host, "Scatter") };
    },
  });
}
