/**
 * Per-feature histograms, split by label — the "guide" half of tuning.
 *
 * A grey total tells you where the values are; the good/neutral/bad overlays tell you whether
 * the feature *separates* them at all. That is the difference between a feature worth putting
 * weight on and one that just has a nice-looking distribution, and it is why the Qt viewer
 * draws all three on every plot.
 *
 * Binned client-side rather than in SQL: at 147 rows the whole matrix is already in memory
 * from one query, and a per-feature SQL round trip per drag would be absurd. The existing
 * `charts/histogram` binmath is for the server-side path over full-size tables.
 */

import type { Goodness } from "../fov-label/goodness";

export interface HistogramBin {
  /** Inclusive lower edge. */
  x0: number;
  /** Exclusive upper edge, except in the last bin where it is inclusive. */
  x1: number;
  total: number;
  good: number;
  neutral: number;
  bad: number;
  unlabeled: number;
}

export interface FeatureHistogram {
  bins: readonly HistogramBin[];
  /** Finite-value extent; equals [0, 1] when there is nothing to bin. */
  domain: readonly [number, number];
  /** Rows whose value could not be measured. Shown per feature because NaNs cost score. */
  missing: number;
  /** Tallest bin, for scaling the bars. */
  maxCount: number;
}

const EMPTY: FeatureHistogram = { bins: [], domain: [0, 1], missing: 0, maxCount: 0 };

export interface HistogramInput {
  /** Non-finite entries count as missing rather than binning at zero. */
  readonly value: number;
  readonly goodness: Goodness;
}

/**
 * Bin one feature's values, counting each bin by label.
 *
 * `domain` pins the extent across re-renders — without it, dragging a curve past the data
 * would rescale the axis under the cursor. Values outside a supplied domain are clamped into
 * the end bins so the counts still sum to the number of measured rows.
 */
export function featureHistogram(
  rows: readonly HistogramInput[],
  binCount = 24,
  domain?: readonly [number, number],
): FeatureHistogram {
  const finite = rows.filter((r) => Number.isFinite(r.value));
  const missing = rows.length - finite.length;
  if (finite.length === 0) return { ...EMPTY, missing };

  let [min, max] = domain ?? [
    finite.reduce((m, r) => Math.min(m, r.value), Number.POSITIVE_INFINITY),
    finite.reduce((m, r) => Math.max(m, r.value), Number.NEGATIVE_INFINITY),
  ];
  if (!(max > min)) {
    // Every value identical: a zero-width domain would divide by zero, so give it one bin's
    // worth of room around the value.
    const pad = Math.abs(min) > 0 ? Math.abs(min) * 0.05 : 0.5;
    min -= pad;
    max += pad;
  }

  const n = Math.max(1, Math.floor(binCount));
  const width = (max - min) / n;
  const bins: HistogramBin[] = Array.from({ length: n }, (_bin, i) => ({
    x0: min + i * width,
    x1: min + (i + 1) * width,
    total: 0,
    good: 0,
    neutral: 0,
    bad: 0,
    unlabeled: 0,
  }));

  for (const row of finite) {
    const raw = Math.floor((row.value - min) / width);
    // Clamp: the top edge lands exactly on n, and a supplied domain may exclude outliers.
    const index = raw < 0 ? 0 : raw >= n ? n - 1 : raw;
    const bin = bins[index];
    bin.total += 1;
    bin[row.goodness] += 1;
  }

  return {
    bins,
    domain: [min, max],
    missing,
    maxCount: bins.reduce((m, b) => Math.max(m, b.total), 0),
  };
}
