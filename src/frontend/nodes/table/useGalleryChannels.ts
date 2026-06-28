import { useDebouncer } from "@tanstack/react-pacer";
import { useSelector } from "@tanstack/react-store";
import { useEffect, useMemo, useState } from "react";
import type { ChannelHash } from "@/lib/branded-types";
import { EMPTY_CHANNEL_HASH, hashChannels } from "@/lib/channel-hash";
import { resolveContrastWindow, safeContrastLimits } from "@/lib/contrast-window";
import type { Metadata } from "@/types";
import { viewerChannelsStore } from "@/stores/ViewerChannelsStore";
import type { ChannelDef } from "@/nodes/image-viewer/viewer/ViewerContext";

export interface GalleryChannels {
  channels: readonly ChannelDef[];
  hash: ChannelHash;
  isPending: boolean;
}

/**
 * Convert metadata plate_channels to ChannelDef[] as fallback when viewer is closed.
 *
 * Contrast must come from `resolveContrastWindow`, NOT the raw `window.start/end`:
 * default OME writers emit the full dtype range (e.g. 0–65535), which maps real
 * fluorescence to ~0 → black crops. This is the same heuristic the live viewer
 * applies (see useFovLoader), so a fallback crop is contrasted like the viewer.
 */
function plateChannelsToDefaults(plateChannels: Metadata["plate_channels"]): ChannelDef[] {
  if (!plateChannels?.length) return [];
  return plateChannels.map((ch) => ({
    label: ch.label,
    color: ch.color,
    visible: true,
    contrastLimits: safeContrastLimits(resolveContrastWindow(ch.window)),
    contrastRange: [ch.window.min, ch.window.max] as [number, number],
    blendMode: "additive" as const,
  }));
}

export function useGalleryChannels(
  instanceId: string,
  wait = 300,
  plateChannels?: Metadata["plate_channels"],
): GalleryChannels {
  const storeChannels = useSelector(viewerChannelsStore, (s) => s.slots[instanceId] ?? ([] as ChannelDef[]));
  const defaults = useMemo(() => plateChannelsToDefaults(plateChannels), [plateChannels]);
  const liveChannels = storeChannels.length > 0 ? storeChannels : defaults;

  const [settled, setSettled] = useState<{ channels: readonly ChannelDef[]; hash: ChannelHash }>(() => ({
    channels: liveChannels,
    hash: liveChannels.length > 0 ? hashChannels(liveChannels) : EMPTY_CHANNEL_HASH,
  }));

  const debouncer = useDebouncer(
    (next: readonly ChannelDef[]) => {
      const hash = next.length > 0 ? hashChannels(next) : EMPTY_CHANNEL_HASH;
      setSettled({ channels: next, hash });
    },
    { wait, leading: false, trailing: true },
  );

  // useEffect fires only when liveChannels reference changes (store update).
  // Using useEffect instead of render body avoids concurrent-mode tearing.
  useEffect(() => {
    debouncer.maybeExecute(liveChannels);
    // debouncer is stable (callback uses stable setState setter)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveChannels, debouncer.maybeExecute]);

  const liveHash = liveChannels.length > 0 ? hashChannels(liveChannels) : EMPTY_CHANNEL_HASH;
  const isPending = liveHash !== settled.hash;

  return { channels: settled.channels, hash: settled.hash, isPending };
}
