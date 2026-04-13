/**
 * ViewerChannelsStore — shares live channel state from ViewerProvider
 * to components outside the viewer tree (e.g. TrackGallery).
 *
 * ViewerProvider writes via publishViewerChannels in a useEffect.
 * TrackGallery reads via useGalleryChannels to match gallery thumbnails
 * to the live viewer channel state (contrast, colors, visibility).
 *
 * Each viewer instance has its own slot keyed by instanceId, enabling
 * N floating DatasetViewerPiP instances to maintain independent channel state.
 */

import { Store } from "@tanstack/store";
import type { ChannelDef } from "../components/viewer/ViewerContext";

export interface ViewerChannelsState {
  slots: Record<string, ChannelDef[]>;
}

export const viewerChannelsStore = new Store({ slots: {} });

export function publishViewerChannels(instanceId: string, channels: ChannelDef[]): void {
  viewerChannelsStore.setState((prev) => ({
    slots: { ...prev.slots, [instanceId]: channels },
  }));
}

export function clearViewerChannels(instanceId: string): void {
  viewerChannelsStore.setState((prev) => {
    const next = { ...prev.slots };
    delete next[instanceId];
    return { slots: next };
  });
}
