/** Gallery plugin descriptor (PLUGIN-ARCHITECTURE §8, §10.5). */

import { z } from "zod";
import { defineNode, exactNodeTypeRef, nodeConfigVersion } from "@ndea/sdk";
import { mountReactNodeBody } from "@/core/node/react-node-body";
import type { GalleryConfig } from "./view";

const CAPABILITIES = ["data-read", "spatial-data", "wasm-bitmap", "focus-coordination"] as const;
export type GalleryCapabilities = (typeof CAPABILITIES)[number];

export const galleryDefinition = defineNode({
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
    return {
      mountBody: (host) => mountReactNodeBody(GalleryPluginView, host, "Gallery"),
    };
  },
});
