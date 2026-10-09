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
      // half/size default to null so documents persisted before they existed
      // still parse; null means "server default" (150 / 320).
      schema: z.object({
        lanes: z.number().nullable(),
        half: z.number().nullable().default(null),
        size: z.number().nullable().default(null),
      }),
      version: nodeConfigVersion(1),
      defaultValue: { lanes: null, half: null, size: null } satisfies GalleryConfig,
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
