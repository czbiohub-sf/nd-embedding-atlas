import { z } from "zod";
import { defineNode, exactNodeTypeRef } from "@ndea/sdk";
import type { NodeBodyMounter } from "../contracts";
import { createImageViewerView } from "./body";
import type { ImageViewerConfig, ImageViewerServices } from "./contracts";

const CAPABILITIES = ["data-read", "spatial-data", "focus-coordination"] as const;

export function createImageViewerDefinition({
  mountBody,
  services,
}: {
  mountBody: NodeBodyMounter;
  services: ImageViewerServices;
}) {
  return defineNode({
    ref: exactNodeTypeRef("image-viewer", "1.0.0"),
    title: "Image Viewer",
    capabilities: CAPABILITIES,
    config: {
      schema: z.object({ datasetKey: z.string().nullable() }),
      defaultValue: { datasetKey: null } satisfies ImageViewerConfig,
    },
    presentation: { icon: "image" },
    documentation: {
      summary: "Displays a plate image dataset with the focused cell highlighted.",
      use: "Pick an image dataset to inspect cells in their spatial context.",
    },
    load: async () => {
      const ImageViewerView = createImageViewerView(services);
      return { mountBody: (host) => mountBody(ImageViewerView, host, "Image Viewer") };
    },
  });
}

export type { ImageViewerCapabilities, ImageViewerConfig, ImageViewerOptions, ImageViewerServices } from "./contracts";
