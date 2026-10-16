/** Gallery plugin descriptor (PLUGIN-ARCHITECTURE §8, §10.5). */

import { z } from "zod";
import { defineNode, exactNodeTypeRef } from "@ndea/sdk";
import { createElement } from "react";
import type { NodeBodyMounter, NodeBodyProps } from "../contracts";
import type { GalleryCapabilities, GalleryConfig, GalleryServices } from "./contracts";

const CAPABILITIES = ["data-read", "spatial-data", "wasm-bitmap", "focus-coordination"] as const;

export function createGalleryDefinition({
  mountBody,
  useServices,
}: {
  mountBody: NodeBodyMounter;
  useServices: () => GalleryServices;
}) {
  return defineNode({
    ref: exactNodeTypeRef("gallery", "1.0.0"),
    title: "Gallery",
    capabilities: CAPABILITIES,
    config: {
      schema: z.object({ lanes: z.number().nullable() }),
      defaultValue: { lanes: null } satisfies GalleryConfig,
    },
    presentation: { icon: "gallery" },
    documentation: {
      summary: "Shows image thumbnails for the selected rows.",
      use: "Use it to browse cell images; click one to focus that row.",
    },
    load: async () => {
      const { GalleryPluginView } = await import("./view");
      function ConfiguredGalleryView(props: NodeBodyProps<GalleryConfig, GalleryCapabilities>) {
        return createElement(GalleryPluginView, { ...props, services: useServices() });
      }
      return {
        mountBody: (host) => mountBody(ConfiguredGalleryView, host, "Gallery"),
      };
    },
  });
}
