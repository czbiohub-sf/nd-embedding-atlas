import { z } from "zod";
import { defineComponent } from "@ndea/sdk";
import type { BodyMounter } from "../contracts";
import type { ScatterConfig, ScatterServices } from "./contracts";

const dim = z.number().int().nonnegative();

export function createScatterDefinition({
  mountBody,
  services,
}: {
  mountBody: BodyMounter;
  services: ScatterServices;
}) {
  return defineComponent({
    type: "scatter",
    title: "Embedding",
    config: {
      schema: z.object({
        obsmKey: z
          .string()
          .nullable()
          .describe("The obsm embedding shown. Switching it resets xDim/yDim to 0/1 and zDim to null."),
        colorByColumn: z.string().nullable(),
        xDim: dim.describe("Embedding dimension on the x axis (0-based column of the obsm matrix)."),
        yDim: dim.describe("Embedding dimension on the y axis (0-based column of the obsm matrix)."),
        zDim: dim
          .nullable()
          .describe(
            "3D: the embedding dimension on the z axis (the embedding needs more columns than zDim). null = 2D.",
          ),
        density: z
          .object({ mode: z.enum(["mean", "dominant", "weave"]) })
          .describe(
            "How dense overviews composite categorical colors per pixel: mean (average color), dominant (the most frequent category), or weave (categories interleaved by share). Continuous color always averages.",
          ),
        pointSize: z.number().positive().max(0.02).describe("Point radius in normalized device units (default 0.002)."),
        legend: z
          .enum(["popover", "pinned"])
          .describe("popover: the legend opens from the control group; pinned: it stays in the view's bottom-left."),
      }),
      defaultValue: {
        obsmKey: null,
        colorByColumn: null,
        xDim: 0,
        yDim: 1,
        zDim: null,
        density: { mode: "mean" },
        pointSize: 0.002,
        legend: "popover",
      } satisfies ScatterConfig,
    },
    documentation: {
      summary: "Plots obs in embedding space, like a UMAP or PCA.",
      use: "Use it to spot structure, then box or lasso a region to select those obs for the view's filter link.",
      note: "Pick the embedding with obsmKey and its axes with xDim/yDim (zDim for 3D, needs 3+ columns). Set density.mode to dominant or weave to keep categories distinct where points overlap. A selection publishes an observation set into the filter link and can be saved as a source; linked color-by scopes share the color column.",
    },
    binds: ["focus", "filter", "colorBy", "viewSync"],
    load: async () => {
      const { createScatterView } = await import("./view");
      const ScatterView = createScatterView(services);
      return { mountBody: (host) => mountBody(ScatterView, host, "Embedding") };
    },
  });
}
