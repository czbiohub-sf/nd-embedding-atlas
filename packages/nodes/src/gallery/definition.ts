/** Gallery plugin descriptor (PLUGIN-ARCHITECTURE §8, §10.5). */

import { z } from "zod";
import { defineNode, exactNodeTypeRef, nodeConfigVersion } from "@ndea/sdk";
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
    role: "view",
    inputs: [
      { id: "in", kind: "pred", label: "In" },
      { id: "in-sel", kind: "sel", label: "In" },
    ],
    outputs: [],
    capabilities: CAPABILITIES,
    dataRequirements: ["plate-image"],
    config: {
      schema: z.object({ lanes: z.number().nullable() }),
      version: nodeConfigVersion(1),
      defaultValue: { lanes: null } satisfies GalleryConfig,
    },
    presentation: { icon: "gallery" },
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
