/** Image-viewer plugin descriptor (PLUGIN-ARCHITECTURE §8, §10.2). */

import { defineDescriptor, type NodeCapability } from "@ndea/sdk";
import type { ViewerConfig, ViewerOptions } from "./view";

declare module "@/core/node/registry-types" {
  interface NodeTypeMap {
    "image-viewer": { config: ViewerConfig; options: ViewerOptions };
  }
}

const CAPABILITIES = new Set<NodeCapability>(["read", "spatial"]);

export const imageViewerDescriptor = defineDescriptor<ViewerConfig, ViewerOptions>({
  id: "image-viewer",
  title: "Image Viewer",
  kind: "view",
  // Highlight is a broadcast bus (§6.7); the sel port exists for graph wiring
  // of a degenerate single-row highlight.
  inputs: [{ id: "highlight-in", kind: "focus", label: "Highlight" }],
  outputs: [],
  capabilities: CAPABILITIES,
  placement: { container: "docked" },
  instancePolicy: "unique-per-container",
  requires: ["plate-image"],
  icon: "image",
  load: async () => {
    const { ImageViewerPluginView } = await import("./view");
    return {
      Component: ImageViewerPluginView,
      defaultConfig: { datasetKey: null },
    };
  },
});
