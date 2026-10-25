/** Gallery component definition: eager metadata; the body is behind the lazy load(). */

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
      // ponytail: the body sizes its lanes to the tile and ignores `lanes`; show it once the body reads it.
      schema: z.object({ lanes: z.number().nullable().meta({ title: "Lanes", hidden: true }) }),
      defaultValue: { lanes: null } satisfies GalleryConfig,
    },
    documentation: {
      summary: "Shows image thumbnails for the selected rows.",
      use: "Use it to browse cell images; click one to focus that row.",
    },
    binds: ["focus", "filter"],
    load: async () => {
      const { GalleryView } = await import("./view");
      function ConfiguredGalleryView(props: BodyProps<GalleryConfig>) {
        return createElement(GalleryView, { ...props, services: useServices() });
      }
      return {
        mountBody: (host) => mountBody(ConfiguredGalleryView, host, "Gallery"),
      };
    },
  });
}
