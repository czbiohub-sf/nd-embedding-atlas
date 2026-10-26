/** Gallery component definition: eager metadata; the body is behind the lazy load(). */

import { defineComponent } from "@ndea/sdk";
import { createElement } from "react";
import type { BodyMounter, BodyProps } from "../contracts";
import type { GalleryServices } from "./contracts";

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
    documentation: {
      summary: "Shows image thumbnails for the selected rows.",
      use: "Use it to browse cell images; click one to focus that row.",
    },
    binds: ["focus", "filter"],
    load: async () => {
      const { GalleryView } = await import("./view");
      function ConfiguredGalleryView(props: BodyProps<unknown>) {
        return createElement(GalleryView, { ...props, services: useServices() });
      }
      return {
        mountBody: (host) => mountBody(ConfiguredGalleryView, host, "Gallery"),
      };
    },
  });
}
