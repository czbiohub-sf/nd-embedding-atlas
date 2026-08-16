import { z } from "zod";
import { defineNode, exactNodeTypeRef, nodeConfigVersion } from "@ndea/sdk";
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
    role: "view",
    inputs: [{ id: "focus-in", kind: "focus", label: "Focus" }],
    outputs: [],
    capabilities: CAPABILITIES,
    dataRequirements: ["plate-image"],
    config: {
      schema: z.object({ datasetKey: z.string().nullable() }),
      version: nodeConfigVersion(1),
      defaultValue: { datasetKey: null } satisfies ImageViewerConfig,
    },
    presentation: { icon: "image" },
    load: async () => {
      const ImageViewerView = createImageViewerView(services);
      return { mountBody: (host) => mountBody(ImageViewerView, host, "Image Viewer") };
    },
  });
}

export type { ImageViewerCapabilities, ImageViewerConfig, ImageViewerOptions, ImageViewerServices } from "./contracts";
