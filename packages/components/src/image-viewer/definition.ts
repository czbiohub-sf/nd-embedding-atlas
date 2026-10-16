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
      schema: z.object({ datasetKey: z.string().nullable() }),
      defaultValue: { datasetKey: null } satisfies ImageViewerConfig,
    },
    documentation: {
      summary: "Displays a plate image dataset with the focused cell highlighted.",
      use: "Pick an image dataset to inspect cells in their spatial context.",
    },
    binds: ["focus", "filter"],
    load: async () => {
      const ImageViewerView = createImageViewerView(services);
      return { mountBody: (host) => mountBody(ImageViewerView, host, "Image Viewer") };
    },
  });
}
