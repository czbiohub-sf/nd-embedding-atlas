import type { ChannelDef } from "../components/viewer/ViewerContext";
import { type ChannelHash, channelHash } from "./branded-types";

/**
 * Stable hash over the display-relevant subset of ChannelDef[].
 *
 * Uses contrastLimits (user display window), NOT contrastRange (slider bounds).
 * Fields are selected explicitly with fixed ordering to avoid JSON key-order variance.
 */
export function hashChannels(channels: readonly ChannelDef[]): ChannelHash {
  return channelHash(
    JSON.stringify(
      channels.map((ch) => ({
        visible: ch.visible,
        lo: ch.contrastLimits[0],
        hi: ch.contrastLimits[1],
        color: ch.color,
        blend: ch.blendMode,
      })),
    ),
  );
}

/** Hash value for empty/no channels. */
export const EMPTY_CHANNEL_HASH: ChannelHash = channelHash("[]");
