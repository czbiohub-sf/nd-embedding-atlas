/** Image-viewer plugin descriptor (PLUGIN-ARCHITECTURE §8, §10.2). */

import type { PluginCapability, PluginDescriptor } from "@/core/plugin/types";
import type { ViewerConfig, ViewerOptions } from "./ImageViewerPluginView";

declare module "@/core/plugin/registry-types" {
  interface PluginTypeMap {
    "image-viewer": { config: ViewerConfig; options: ViewerOptions };
  }
}

const CAPABILITIES = new Set<PluginCapability>(["read", "spatial"]);

export const imageViewerDescriptor: PluginDescriptor<ViewerConfig, ViewerOptions> = {
  id: "image-viewer",
  title: "Image Viewer",
  kind: "view",
  // Highlight is a broadcast bus (§6.7); the rowset port exists for graph wiring
  // of a degenerate single-row highlight.
  inputs: [{ id: "highlight-in", kind: "rowset", label: "Highlight" }],
  outputs: [],
  capabilities: CAPABILITIES,
  placement: { container: "docked" },
  instancePolicy: "unique-per-container",
  isAvailable: (ctx) => ctx.hasPlate,
  icon: "image",
  load: async () => {
    const { ImageViewerPluginView } = await import("./ImageViewerPluginView");
    return {
      Component: ImageViewerPluginView,
      defaultConfig: { datasetKey: null },
    };
  },
};
