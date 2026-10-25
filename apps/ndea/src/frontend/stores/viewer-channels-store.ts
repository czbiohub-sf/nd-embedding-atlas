/**
 * ViewerChannelsStore: shares live channel state from ViewerProvider
 * to components outside the viewer tree (galleries).
 *
 * ViewerProvider writes via publishViewerChannels in a useEffect.
 * useGalleryChannels reads it to match gallery thumbnails to the live
 * viewer channel state (contrast, colors, visibility).
 *
 * Keyed by slot: the dashboard element id, "docked", or a dataset key.
 * Viewers and galleries sharing a slot share channel state.
 */

import { Store } from "@tanstack/store";
import type { ChannelDef } from "@ndea/components/image-viewer";

export interface ViewerChannelsState {
  slots: Record<string, ChannelDef[]>;
}

const initialState: ViewerChannelsState = { slots: {} };
export const viewerChannelsStore = new Store(initialState);

export function publishViewerChannels(slot: string, channels: ChannelDef[]): void {
  viewerChannelsStore.setState((prev) => ({
    slots: { ...prev.slots, [slot]: channels },
  }));
}

export function clearViewerChannels(slot: string): void {
  viewerChannelsStore.setState((prev) => {
    const next = { ...prev.slots };
    delete next[slot];
    return { slots: next };
  });
}
