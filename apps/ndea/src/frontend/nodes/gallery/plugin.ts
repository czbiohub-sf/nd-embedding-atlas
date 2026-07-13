/** Gallery plugin descriptor (PLUGIN-ARCHITECTURE §8, §10.5). */

import { defineDescriptor, type NodeCapability } from "@ndea/sdk";
import type { GalleryConfig, GalleryOptions } from "./view";

declare module "@/core/node/registry-types" {
  interface NodeTypeMap {
    gallery: { config: GalleryConfig; options: GalleryOptions };
  }
}

const CAPABILITIES = new Set<NodeCapability>(["read", "spatial", "collections", "wasm-bitmap"]);

export const galleryDescriptor = defineDescriptor<GalleryConfig, GalleryOptions>({
  id: "gallery",
  title: "Gallery",
  kind: "view",
  inputs: [{ id: "filter-in", kind: "pred", label: "Filter" }],
  outputs: [],
  capabilities: CAPABILITIES,
  placement: { container: "slide", side: "bottom" },
  instancePolicy: "unique-per-container",
  requires: ["plate-image"],
  icon: "gallery",
  load: async () => {
    const { GalleryPluginView } = await import("./view");
    return {
      Component: GalleryPluginView,
      defaultConfig: { lanes: null },
    };
  },
});
