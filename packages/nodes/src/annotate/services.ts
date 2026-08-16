import type { Metadata } from "@ndea/protocol";
import type { GalleryChannels } from "../gallery/useGalleryChannels";

export interface AnnotateServices {
  readonly channels: (instanceId: string, wait: number, plateChannels?: Metadata["plate_channels"]) => GalleryChannels;
}
