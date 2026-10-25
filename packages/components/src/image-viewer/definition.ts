import { z } from "zod";
import { defineComponent } from "@ndea/sdk";
import type { BodyMounter } from "../contracts";
import { createImageViewerView } from "./body";
import type { ImageViewerConfig, ImageViewerServices } from "./contracts";

export function createImageViewerDefinition({
  mountBody,
  services,
}: {
  mountBody: BodyMounter;
  services: ImageViewerServices;
}) {
  return defineComponent({
    type: "image-viewer",
    title: "Image Viewer",
    config: {
      schema: z.object({
        datasetKey: z.string().nullable().meta({ title: "Dataset", section: "data", control: "dataset" }),
        render: z
          .enum(["local", "remote"])
          .describe(
            "Where the image renders. local: on this browser's GPU. remote: in headless Chrome on the ndea server's machine (next to the data, e.g. an HPC GPU node), streamed to this tile as video; pan, zoom and the viewer's controls still work.",
          )
          .meta({ title: "Render", section: "display" }),
      }),
      defaultValue: { datasetKey: null, render: "local" } satisfies ImageViewerConfig,
    },
    documentation: {
      summary: "Displays a plate image dataset with the focused cell highlighted.",
      use: "Pick an image dataset to inspect cells in their spatial context.",
      note: 'Set render to "remote" to render on the server\'s GPU and stream the result (needs Chrome or Chromium on the server; `ndea self doctor` checks it).',
    },
    binds: ["focus", "filter"],
    load: async () => {
      const ImageViewerView = createImageViewerView(services);
      return { mountBody: (host) => mountBody(ImageViewerView, host, "Image Viewer") };
    },
  });
}
