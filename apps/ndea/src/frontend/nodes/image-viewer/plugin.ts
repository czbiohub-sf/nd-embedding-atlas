/** Image-viewer plugin descriptor (PLUGIN-ARCHITECTURE §8, §10.2). */

import { z } from "zod";
import { defineNode, exactNodeTypeRef, nodeConfigVersion } from "@ndea/sdk";
import { mountReactNodeBody } from "@/core/node/react-node-body";
import type { ViewerConfig } from "./view";

const CAPABILITIES = ["data-read", "spatial-data", "focus-coordination"] as const;
export type ImageViewerCapabilities = (typeof CAPABILITIES)[number];

export const imageViewerDefinition = defineNode({
  ref: exactNodeTypeRef("image-viewer", "1.0.0"),
  title: "Image Viewer",
  role: "view",
  // Highlight is a broadcast bus (§6.7); the sel port exists for graph wiring
  // of a degenerate single-row highlight.
  inputs: [{ id: "highlight-in", kind: "focus", label: "Highlight" }],
  outputs: [],
  capabilities: CAPABILITIES,
  dataRequirements: ["plate-image"],
  config: {
    schema: z.object({ datasetKey: z.string().nullable() }),
    version: nodeConfigVersion(1),
    defaultValue: { datasetKey: null } satisfies ViewerConfig,
  },
  presentation: { icon: "image" },
  load: async () => {
    const { ImageViewerPluginView } = await import("./view");
    return {
      mountBody: (host) => mountReactNodeBody(ImageViewerPluginView, host, "Image Viewer"),
    };
  },
});
