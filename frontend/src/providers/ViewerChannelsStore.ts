/**
 * ViewerChannelsStore — shares live channel state from ViewerProvider
 * to components outside the viewer tree (e.g. TrackGallery).
 *
 * ViewerProvider writes via publishViewerChannels in a useEffect.
 * TrackGallery reads via useGalleryChannels to match gallery thumbnails
 * to the live viewer channel state (contrast, colors, visibility).
 */

import { Store } from "@tanstack/store";
import type { ChannelDef } from "../components/viewer/ViewerContext";

// Discriminated union: null sourceInstance = no viewer active, channels must be empty.
export type ViewerChannelsState =
  | { sourceInstance: "docked" | "pip"; channels: ChannelDef[] }
  | { sourceInstance: null; channels: readonly [] };

export const viewerChannelsStore = new Store<ViewerChannelsState>({
  sourceInstance: null,
  channels: [],
});

export function publishViewerChannels(sourceInstance: "docked" | "pip", channels: ChannelDef[]): void {
  viewerChannelsStore.setState(() => ({ sourceInstance, channels }));
}

export function clearViewerChannels(): void {
  viewerChannelsStore.setState(() => ({ sourceInstance: null, channels: [] }));
}
