import { useDebouncer } from "@tanstack/react-pacer";
import { useStore } from "@tanstack/react-store";
import { useEffect, useMemo, useState } from "react";
import type { ChannelHash } from "../../lib/branded-types";
import { EMPTY_CHANNEL_HASH, hashChannels } from "../../lib/channel-hash";
import type { Metadata } from "../../types";
import { viewerChannelsStore } from "../../stores/ViewerChannelsStore";
import type { ChannelDef } from "../viewer/ViewerContext";

export interface GalleryChannels {
  channels: readonly ChannelDef[];
  hash: ChannelHash;
  isPending: boolean;
}

/** Convert metadata plate_channels to ChannelDef[] as fallback when viewer is closed. */
function plateChannelsToDefaults(plateChannels: Metadata["plate_channels"]): ChannelDef[] {
  if (!plateChannels?.length) return [];
  return plateChannels.map((ch) => ({
    label: ch.label,
    color: ch.color,
    visible: true,
    contrastLimits: [ch.window.start, ch.window.end] as [number, number],
    contrastRange: [ch.window.min, ch.window.max] as [number, number],
    blendMode: "additive" as const,
  }));
}

export function useGalleryChannels(
  instanceId: string,
  wait = 300,
  plateChannels?: Metadata["plate_channels"],
): GalleryChannels {
  const storeChannels = useStore(viewerChannelsStore, (s) => s.slots[instanceId] ?? ([] as ChannelDef[]));
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
