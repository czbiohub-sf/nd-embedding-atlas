/**
 * Per-slide contrast windows for the sweep.
 *
 * The original design derived ONE window from the middle peer and applied it to
 * every slide, on the reasoning that a comparison is only honest under an
 * identical window — otherwise a regularizer could look better purely because it
 * was stretched differently. That reasoning assumed peers differ in appearance
 * but share a scale. On a regularization sweep they do not: measured on the
 * autoreg plate, one group's percentile window runs [-9.67, 11.5] at reg_power
 * -6 but [-1.31e-5, 1.58e-5] at reg_power 0 — roughly six orders of magnitude
 * across the axis, because intensity scale IS the swept variable. A single window
 * is off by ~100x within a few steps, so every slide but a couple collapses into
 * a flat band around zero and renders uniform grey.
 *
 * So autocontrast is per slide: each one is windowed by its own pixel statistics.
 * That normalizes away absolute intensity, which is the right trade here — the
 * scale is a deterministic function of the regularizer and is already printed on
 * the card, while the thing being judged (structure, noise, artefacts) is only
 * visible once each slide is exposed properly.
 *
 * With autocontrast off, every slide falls back to the shared published window,
 * which is still the honest choice for a variant axis that preserves scale.
 *
 * Only the slides in the virtualization window are fetched, not all 25, and the
 * responses are cached forever: a FOV's statistics cannot change under us.
 */

import { useQueries } from "@tanstack/react-query";
import { useMemo } from "react";
import { ChannelStatsResponseSchema } from "@ndea/protocol";
import { deriveAutoLimits } from "../image-viewer/contrast-window";
import type { ChannelDef } from "../gallery/contracts";

/** One slide to derive a window for. */
export interface SweepWindowSlide {
  /** Slide index, matching the stage's slot index. */
  index: number;
  fovName: string;
  datasetKey: string | undefined;
}

export interface SweepWindows {
  /**
   * Per-slide channel overrides keyed by slide index. A slide with no entry
   * renders under the shared base window.
   */
  bySlide: ReadonlyMap<number, readonly ChannelDef[]>;
  /** Identity of every resolved window, for cache keys and effect gating. */
  key: string;
  /** True once at least one slide is rendering under its own derived window. */
  autoContrasted: boolean;
}

export interface UseSweepWindowsOptions {
  /** Baseline channels: viewer-published when present, else plate defaults. */
  base: readonly ChannelDef[];
  /** Identity of `base`, so the composed key changes when the baseline does. */
  baseHash: string;
  /**
   * Slides to derive windows for — the virtualization window, not the whole
   * group. MUST be referentially stable across renders (memoize it), or the
   * query list is rebuilt on every render.
   */
  slides: readonly SweepWindowSlide[];
  /** False disables every fetch and returns no overrides. */
  enabled: boolean;
}

export function useSweepWindows({ base, baseHash, slides, enabled }: UseSweepWindowsOptions): SweepWindows {
  // A window is a per-channel colour plus limits, so there is nothing to derive
  // without a baseline to carry the colours.
  const active = enabled && base.length > 0;

  const results = useQueries({
    queries: slides.map((slide) => ({
      queryKey: ["sweep-channel-stats", slide.fovName, slide.datasetKey ?? null],
      enabled: active && slide.fovName.length > 0,
      staleTime: Infinity,
      // A missing FOV is a dead end, not a transient failure: the variant axis can
      // name a plate position that was never written.
      retry: false,
      queryFn: async ({ signal }: { signal: AbortSignal }) => {
        const suffix = slide.datasetKey ? `?dataset_key=${encodeURIComponent(slide.datasetKey)}` : "";
        const res = await fetch(`/api/channel-stats/${slide.fovName}${suffix}`, { signal });
        if (!res.ok) throw new Error(`channel-stats failed: ${res.status}`);
        return ChannelStatsResponseSchema.parse(await res.json());
      },
    })),
  });

  // `useQueries` returns a fresh array every render, so the memo below is keyed on
  // a digest of the resolved numbers rather than on the results themselves.
  const digest = results
    .map((result, position) => {
      const stats = result.data?.channels;
      const index = slides[position]?.index ?? position;
      if (!stats?.length) return `${index}:-`;
      return `${index}:${stats.map((stat) => `${stat.lo}/${stat.hi}`).join("|")}`;
    })
    .join(",");

  const bySlide = useMemo(() => {
    const map = new Map<number, readonly ChannelDef[]>();
    if (!active) return map;
    slides.forEach((slide, position) => {
      const stats = results[position]?.data?.channels;
      if (!stats?.length) return;
      map.set(
        slide.index,
        base.map((channel, channelIndex) => {
          const stat = stats[channelIndex];
          // "percentile" is what the live viewer's autocontrast uses, so a slide
          // and the wired Image Viewer agree on the same FOV.
          return stat ? { ...channel, contrastLimits: deriveAutoLimits(stat, "percentile") } : channel;
        }),
      );
    });
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `results` is captured by `digest`.
  }, [active, base, slides, digest]);

  const key = useMemo(() => {
    if (bySlide.size === 0) return baseHash;
    return `${baseHash}|auto:${digest}`;
  }, [bySlide, baseHash, digest]);

  return { bySlide, key, autoContrasted: bySlide.size > 0 };
}
