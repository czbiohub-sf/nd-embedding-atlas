/** vgplot plugin descriptor: eager metadata; the framework-neutral body is behind the lazy load(). */

import { defineComponent } from "@ndea/sdk";
import { VGPLOT_DEFAULT_CONFIG, vgplotConfigSchema } from "./spec-schema";

export function createVgplotDefinition() {
  return defineComponent({
    type: "vgplot",
    title: "Plot",
    config: {
      schema: vgplotConfigSchema,
      defaultValue: VGPLOT_DEFAULT_CONFIG,
    },
    documentation: {
      summary: "Draws a Mosaic vgplot chart from a plot spec.",
      use: "Pick a mark and a column, then brush the plot to select those rows.",
    },
    binds: ["filter"],
    load: async () => {
      const { mountVgplotBody } = await import("./body");
      return {
        mountBody: (host) => mountVgplotBody(host),
      };
    },
  });
}
