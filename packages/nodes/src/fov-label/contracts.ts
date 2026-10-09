import type { Metadata } from "@ndea/protocol";
import type { GalleryChannels } from "../gallery/useGalleryChannels";
import type { NodeBodyProps as SharedNodeBodyProps } from "../contracts";

export type FovLabelCapabilities = "data-read" | "spatial-data" | "annotation-write" | "focus-coordination";

export interface FovLabelConfig {
  /**
   * Crop framing in source pixels. FOV-level rows need this large enough to cover the
   * whole field; the cell-framing default (150) would show a 300x300 centre window.
   */
  half: number | null;
  /** Rendered crop edge in output pixels. */
  size: number | null;
  /**
   * On-screen cell edge in CSS pixels — the node's zoom. Fixed rather than fractional:
   * `1fr` tracks divide the tile width, so three 7x7 wells in a short tile collapse to
   * ~15px and the images stop being judgeable. The container scrolls instead.
   */
  cellPx: number | null;
  /**
   * How cells are arranged within a well:
   *   "plate"  — at their physical grid position, so positional effects are visible
   *   "ranked" — best-first by `rankColumn`, mirroring the Qt viewer's ranked panel
   * Both are useful and answer different questions; the toggle exists so users can say
   * which they prefer rather than us guessing.
   */
  layout: "plate" | "ranked" | null;
  /** Column ranked on in "ranked" layout; falls back to the goodness label. */
  rankColumn: string | null;
  /** Index of the single plate channel to display; null shows the first. */
  channel: number | null;
}

export type FovLabelBodyProps = SharedNodeBodyProps<FovLabelConfig, FovLabelCapabilities>;

export interface FovLabelServices {
  readonly metadata: Metadata;
  readonly viewerZ: (instanceId: string) => number;
  readonly channels: (instanceId: string, wait: number, plateChannels?: Metadata["plate_channels"]) => GalleryChannels;
}
