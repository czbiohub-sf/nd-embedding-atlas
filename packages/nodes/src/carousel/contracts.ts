/**
 * Carousel node contracts: config, capabilities, and the app-provided services.
 *
 * The dataset service surface is deliberately the SAME shape the Gallery node
 * declares. Both nodes need the identical three things from the app — session
 * metadata, the live viewer Z plane, and the shared channel state — and the app
 * already has one adapter that produces them. Re-declaring a private copy here
 * would let the two drift apart for no benefit.
 */

import type { GalleryDatasetServices } from "../gallery/contracts";

export interface CarouselConfig {
  /** Column whose shared value defines one comparison group, e.g. `row_idx`. */
  groupBy: string | null;
  /** Column that varies within a group, e.g. `reg_power`. */
  variantBy: string | null;
  /** Annotation column the good/bad verdict is written to. */
  column: string | null;
  labels: string[];
  /** How many variants are on screen at once. The point of the node. */
  slidesPerView?: number;
  /**
   * Shared contrast: `true` forces autocontrast from the sweep's own pixel stats,
   * `false` forces the published/plate window, `null` follows the default (auto
   * only when no live viewer has published a window).
   */
  autoContrast?: boolean | null;
}

export type CarouselOptions = Record<string, never>;

export type CarouselCapabilities = "data-read" | "annotation-write" | "focus-coordination";

export interface CarouselServices {
  readonly dataset: GalleryDatasetServices;
}
