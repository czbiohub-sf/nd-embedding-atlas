import type { Metadata } from "@ndea/protocol";
import type { Categorize } from "../query/category-mapping";

export interface GalleryConfig {
  /** Caption fields under (or over) each crop, in order; empty shows the image only. */
  columns: string[];
  /** Group fields, outermost first: nested sections in the grid; in strips, the innermost names a strip. */
  groupBy: string[];
  /** `grid` wraps crops in reading order; `strips` puts each innermost group on one line. */
  layout: "grid" | "strips";
  /** Strips only: one shared column per value of this field (a pivot, e.g. `t`); null runs each strip in sort order. */
  columnsBy: string | null;
  /** Crop tile edge in px. */
  size: number;
  /** Magnification in percent: 100 crops 150 image px either side of the obs, 200 half that. */
  zoom: number;
  /** Captions as lines below the crop, or over its bottom edge on hover and focus. */
  caption: "below" | "overlay";
}

export type ChannelHash = string & { readonly __brand: "ChannelHash" };
export interface ChannelDef {
  label: string;
  color: string;
  visible: boolean;
  contrastLimits: [number, number];
  contrastRange: [number, number];
  blendMode: "normal" | "additive" | "multiply" | "subtractive";
}
export interface GalleryDatasetServices {
  readonly metadata: Metadata;
  readonly viewerZ: (elementId: string) => number;
  readonly channels: (
    elementId: string,
    wait: number,
    plateChannels?: Metadata["plate_channels"],
  ) => {
    channels: readonly ChannelDef[];
    hash: ChannelHash;
    isPending: boolean;
  };
}
/** What the color strip needs to color categories as the scatter does. */
export interface GalleryColorServices {
  readonly categorize: Categorize;
  readonly getCategoricalPalette: (name: string, n: number) => string[];
  readonly pickDefaultCategoricalPalette: (count: number) => string;
}
export interface GalleryServices {
  readonly dataset: GalleryDatasetServices;
  readonly color: GalleryColorServices;
}
