import type { Metadata } from "@ndea/protocol";
import type { NodeBodyProps as SharedNodeBodyProps } from "../contracts";

export type ChannelHash = string & { readonly __brand: "ChannelHash" };
export type NodeBodyProps<Config, Capabilities extends GalleryCapabilities> = SharedNodeBodyProps<Config, Capabilities>;
export interface GalleryConfig {
  lanes: number | null;
}
export type GalleryOptions = Record<string, never>;
export type GalleryCapabilities = "data-read" | "spatial-data" | "wasm-bitmap" | "focus-coordination";
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
  readonly viewerZ: (instanceId: string) => number;
  readonly channels: (
    instanceId: string,
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
