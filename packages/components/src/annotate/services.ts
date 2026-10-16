import type { Metadata } from "@ndea/protocol";
import type { GalleryChannels } from "../gallery/useGalleryChannels";

export interface AnnotateServices {
  readonly viewerZ: (elementId: string) => number;
  readonly channels: (elementId: string, wait: number, plateChannels?: Metadata["plate_channels"]) => GalleryChannels;
}
