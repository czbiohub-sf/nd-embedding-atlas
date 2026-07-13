/**
 * Shared OME-Zarr contrast-window resolution.
 *
 * Default OME-Zarr writers often emit `window: {start: 0, end: dtypeMax}` —
 * the full dtype range, not a useful display range. Real fluorescence data
 * fills <10% of the range, so it renders black at full contrast. When we
 * detect that pattern (start==min && end==max with a >1000 span), shrink
 * `end` to 1/16 of the range.
 *
 * Both the live image viewer (`useFovLoader`) and the gallery crop fallback
 * (`useGalleryChannels` → `plateChannelsToDefaults`) MUST use this so a crop
 * thumbnail is contrasted identically to the viewer. Skipping it in the
 * gallery fallback path renders every default-window channel black.
 */

import type { ChannelStat } from "@ndea/protocol";

export interface ContrastWindow {
  start: number;
  end: number;
  min: number;
  max: number;
}

/** Resolve an OME window to display [lo, hi], shrinking uninformative full-range defaults. */
export function resolveContrastWindow(window: ContrastWindow | undefined): [number, number] {
  if (!window) return [0, 65535];
  const { start, end, min, max } = window;
  const range = max - min;
  const isUninformativeDefault = start === min && end === max && range > 1000;
  const resolvedEnd = isUninformativeDefault ? min + range / 16 : end;
  return [start, resolvedEnd];
}

/**
 * Resolve an OME window to the slider's [min, max] EXTENT (not the default
 * display limits). Mirrors `resolveContrastWindow`'s "uninformative full-dtype
 * default" detection so the track spans the meaningful range instead of dead
 * dtype space — otherwise the useful limits (e.g. 0–4096 of a 0–65535 uint16
 * range) cram into the far-left 6% of the track and the thumbs visually
 * collide. Negatives are preserved: phase images carry a genuine negative
 * `min`, which becomes the low end as-is (never clamped to 0).
 */
export function resolveContrastRange(window: ContrastWindow | undefined): [number, number] {
  if (!window) return [0, 65535];
  const { start, end, min, max } = window;
  const range = max - min;
  const isUninformativeDefault = start === min && end === max && range > 1000;
  // Headroom: the resolved default end (min + range/16, see resolveContrastWindow)
  // lands at the track midpoint, leaving room to push brighter without a dead
  // left margin.
  const hi = isUninformativeDefault ? min + range / 8 : max;
  return [min, hi];
}

/** Ensure contrast limits are strictly increasing — idetik throws if lo >= hi. */
export function safeContrastLimits(limits: [number, number]): [number, number] {
  return limits[0] < limits[1] ? limits : [limits[0], limits[0] + 1];
}

// ── Autocontrast ─────────────────────────────────────────────────────────────

/**
 * How autocontrast derives display limits from a channel's pixel stats:
 *   - "percentile" — Fiji-style saturation limits (robust to hot pixels /
 *     background spikes; the right default for fluorescence).
 *   - "minmax"     — raw data extent (napari-style; can be blown out by a
 *     single bright pixel, but faithful for range inspection).
 * Both derive from the SAME stats payload, so switching never re-fetches.
 */
export type AutoContrastMethod = "percentile" | "minmax";

/** Derive display [lo, hi] from a channel's pixel stats for the chosen method. */
export function deriveAutoLimits(stat: ChannelStat, method: AutoContrastMethod): [number, number] {
  const limits: [number, number] = method === "minmax" ? [stat.dataMin, stat.dataMax] : [stat.lo, stat.hi];
  return safeContrastLimits(limits);
}
