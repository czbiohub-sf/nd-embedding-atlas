/**
 * Channel selection for the plate grid: show ONE channel at a time, contrasted from
 * measured pixel statistics rather than the store's declared window.
 *
 * Two reasons this node does not just reuse the viewer's channel state:
 *
 * 1. The declared window lies. These plates carry `{start: 0, end: 65535, min: 0,
 *    max: 65535}` on every channel — the full dtype range — while the pixels are
 *    float32 in 0..1. Mapping 0..65535 onto 8 bits sends every real value to zero, so
 *    the crops come back uniformly black. `useGalleryChannels` guards against raw
 *    `start`/`end` by preferring `min`/`max`, but here those are equally wrong, so only
 *    `/api/channel-stats` (which reads actual pixels) recovers a usable range.
 *
 * 2. Only `image-viewer` populates the shared viewer channel store. A dashboard without
 *    one would silently render black, which makes the node dependent on a node it has no
 *    relationship to.
 *
 * One channel at a time mirrors the Qt feature viewer's `channel: [mask]` picker: a
 * brightfield channel and a segmentation channel answer different questions, and blending
 * them by default obscures both.
 */

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Metadata } from "@ndea/protocol";
import type { ChannelDef, ChannelHash } from "../gallery/contracts";

interface ChannelStat {
  lo: number;
  hi: number;
  dataMin: number;
  dataMax: number;
}

/**
 * A channel whose values are object IDs rather than intensities. Contrast-stretching
 * those is meaningless — label 33 is not "brighter" than label 1 — so they are rendered
 * over their full ID range and flagged for the caller.
 *
 * Detected from the measured data rather than the name: an integral, small, non-negative
 * maximum is what a label or binary mask looks like, whatever it is called.
 */
export function looksLikeMask(stat?: ChannelStat): boolean {
  if (!stat) return false;
  return stat.dataMin >= 0 && stat.dataMax > 1 && stat.dataMax <= 4096 && Number.isInteger(stat.dataMax);
}

export interface FovChannelsResult {
  /** Exactly one visible channel, contrasted from measured stats. */
  channels: readonly ChannelDef[];
  hash: ChannelHash;
  /** Channel labels, in plate order, for the picker. */
  labels: readonly string[];
  isMask: boolean;
  isPending: boolean;
}

/**
 * @param plateChannels declared channels, used for labels and colours only
 * @param sampleFovName any FOV in the plate; stats are read once and reused
 * @param index         which channel to display
 */
export function useFovChannels(
  plateChannels: Metadata["plate_channels"] | undefined,
  sampleFovName: string | null,
  index: number,
): FovChannelsResult {
  const labels = (plateChannels ?? []).map((c, i) => c.label || `channel ${i}`);
  const labelsKey = labels.join("\u0000");

  const stats = useQuery<ChannelStat[]>({
    // Stats are a property of the store, not of one field: any FOV gives the same
    // answer, so this is fetched once and shared by all 147 cells.
    queryKey: ["fov-channel-stats", sampleFovName],
    enabled: sampleFovName != null,
    staleTime: Number.POSITIVE_INFINITY,
    queryFn: async ({ signal }) => {
      const response = await fetch(`/api/channel-stats/${encodeURIComponent(sampleFovName!)}`, { signal });
      if (!response.ok) throw new Error(`channel-stats failed: ${response.status}`);
      const body = (await response.json()) as { channels?: ChannelStat[] };
      return body.channels ?? [];
    },
  });

  const stat = stats.data?.[index];
  const isMask = looksLikeMask(stat);
  // Masks span their whole ID range; intensity channels use the measured percentiles.
  const limits: [number, number] = stat ? (isMask ? [stat.dataMin, stat.dataMax] : [stat.lo, stat.hi]) : [0, 1];

  // Memoised on the hash: a fresh array every render would make every consumer re-render
  // even when the channel selection has not moved, which at 147 cells is 147 re-renders per
  // keystroke elsewhere in the node.
  const [lo, hi] = limits;
  const dataMin = stat?.dataMin ?? 0;
  const dataMax = stat?.dataMax ?? 1;
  const hash = JSON.stringify([index, lo, hi]) as ChannelHash;

  // Memoised on VALUES, not on the freshly-built `limits` tuple: an array literal is a new
  // identity every render, so depending on it would rebuild `channels` every time and
  // re-render all 147 cells whenever anything else in the node changed.
  const channels = useMemo<ChannelDef[]>(
    () =>
      (labelsKey === "" ? [] : labelsKey.split("\u0000")).map((label, i) => ({
        label,
        color: "FFFFFF",
        visible: i === index,
        contrastLimits: i === index ? [lo, hi] : [0, 1],
        contrastRange: [dataMin, dataMax] as [number, number],
        blendMode: "normal" as const,
      })),
    [labelsKey, index, lo, hi, dataMin, dataMax],
  );

  return { channels, hash, labels, isMask, isPending: stats.isLoading };
}
