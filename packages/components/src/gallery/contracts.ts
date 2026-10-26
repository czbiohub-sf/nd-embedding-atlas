import type { Metadata } from "@ndea/protocol";

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
export interface GalleryServices {
  readonly dataset: GalleryDatasetServices;
}
