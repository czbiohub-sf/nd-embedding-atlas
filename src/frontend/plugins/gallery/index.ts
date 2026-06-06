/** Gallery plugin descriptor (PLUGIN-ARCHITECTURE §8, §10.5). */

import type { PluginCapability, PluginDescriptor } from "@/core/plugin/types";
import type { GalleryConfig, GalleryOptions } from "./GalleryPluginView";

declare module "@/core/plugin/registry-types" {
  interface PluginTypeMap {
    gallery: { config: GalleryConfig; options: GalleryOptions };
  }
}

const CAPABILITIES = new Set<PluginCapability>(["read", "spatial", "collections", "wasm-bitmap"]);

export const galleryDescriptor: PluginDescriptor<GalleryConfig, GalleryOptions> = {
  id: "gallery",
  title: "Gallery",
  kind: "view",
  inputs: [{ id: "filter-in", kind: "selection", label: "Filter" }],
  outputs: [],
  capabilities: CAPABILITIES,
  placement: { container: "slide", side: "bottom" },
  instancePolicy: "unique-per-container",
  isAvailable: (ctx) => ctx.hasPlate,
  icon: "gallery",
  load: async () => {
    const { GalleryPluginView } = await import("./GalleryPluginView");
    return {
      Component: GalleryPluginView,
      defaultConfig: { lanes: null },
    };
  },
};
