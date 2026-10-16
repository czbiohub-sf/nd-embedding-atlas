/** Gallery plugin descriptor (PLUGIN-ARCHITECTURE §8, §10.5). */

import { z } from "zod";
import { defineComponent } from "@ndea/sdk";
import { createElement } from "react";
import type { BodyMounter, BodyProps } from "../contracts";
import type { GalleryConfig, GalleryServices } from "./contracts";

export function createGalleryDefinition({
  mountBody,
  useServices,
}: {
  mountBody: BodyMounter;
  useServices: () => GalleryServices;
}) {
  return defineComponent({
    type: "gallery",
    title: "Gallery",
    config: {
      schema: z.object({ lanes: z.number().nullable() }),
      defaultValue: { lanes: null } satisfies GalleryConfig,
    },
    documentation: {
      summary: "Shows image thumbnails for the selected rows.",
      use: "Use it to browse cell images; click one to focus that row.",
    },
    binds: ["focus", "filter"],
    load: async () => {
      const { GalleryPluginView } = await import("./view");
      function ConfiguredGalleryView(props: BodyProps<GalleryConfig>) {
        return createElement(GalleryPluginView, { ...props, services: useServices() });
      }
      return {
        mountBody: (host) => mountBody(ConfiguredGalleryView, host, "Gallery"),
      };
    },
  });
}
