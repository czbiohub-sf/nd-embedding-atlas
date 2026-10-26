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
    title: "Crop gallery",
    config: {
      // The toolbar owns fields, groups, layout and strip columns, so view settings hide them.
      schema: z.object({
        columns: z.array(z.string()).meta({ title: "Caption fields", section: "data", hidden: true }),
        groupBy: z.array(z.string()).meta({ title: "Group by", section: "data", hidden: true }),
        layout: z.enum(["grid", "strips"]).meta({ title: "Layout", hidden: true }),
        columnsBy: z.string().nullable().meta({ title: "Strip columns", control: "column", hidden: true }),
        size: z.number().int().min(64).max(320).meta({ title: "Crop size" }),
        zoom: z.number().int().min(25).max(400).meta({ title: "Zoom %" }),
        caption: z.enum(["below", "overlay"]).meta({ title: "Captions" }),
      }),
      defaultValue: {
        columns: [],
        groupBy: [],
        layout: "grid",
        columnsBy: null,
        size: 128,
        zoom: 100,
        caption: "below",
      } satisfies GalleryConfig,
    },
    documentation: {
      summary: "Shows the obs as image crops, with the table's search, filter, sort, group and selection.",
      use: "Use it to look at cells: group crops into nested sections, or into strips (one per track when grouped by fov_name then track_id) with one column per value of a field such as t; click a crop to focus it, shift- or ⌘-click to select.",
      note: "columns are the caption fields (empty shows images only); groupBy nests groups outermost first; layout is grid | strips; columnsBy (strips) gives every strip one shared column per distinct value of that field, null runs each strip in sort order; size is the crop edge in px; zoom is a percent (100 = 150 image px either side); caption is below | overlay. The filter builder (conditions joined by and or or) publishes on the `filter` facet and a selection on the `selection` facet, like the table; sort follows the `ordering` link; each crop's color strip follows the `colorBy` link's categorical column.",
    },
    binds: ["focus", "filter", "ordering", "colorBy"],
    load: async () => {
      const { GalleryView } = await import("./view");
      function ConfiguredGalleryView(props: BodyProps<GalleryConfig>) {
        return createElement(GalleryView, { ...props, services: useServices() });
      }
      return {
        mountBody: (host) => mountBody(ConfiguredGalleryView, host, "Crop gallery"),
      };
    },
  });
}
