import type { Metadata } from "@ndea/protocol";
import type { NodeBodyProps as SharedNodeBodyProps } from "../contracts";

export type ChannelHash = string & { readonly __brand: "ChannelHash" };
export type NodeBodyProps<Config, Capabilities extends GalleryCapabilities> = SharedNodeBodyProps<Config, Capabilities>;
export interface GalleryConfig {
  lanes: number | null;
  /**
   * Crop half-size in SOURCE pixels; null keeps the cell-framing default (150).
   * FOV-level rows need this raised to cover the whole field — at 150 a
   * 1193×1664 field renders a 300×300 centre window (4.5% of it), which is
   * pixel noise rather than a field you can judge.
   */
  half: number | null;
  /** Rendered crop edge in output pixels; null keeps the default (320). */
  size: number | null;
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
