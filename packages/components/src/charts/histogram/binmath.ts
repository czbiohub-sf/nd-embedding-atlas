/** Pure bin-math + brush predicate for the histogram (testable without a coordinator). */

import type { FilterClause } from "@ndea/protocol";

export interface Stats {
  min: number;
  max: number;
  count: number;
}

export interface BinParams {
  binStart: number;
  binSize: number;
}

/**
 * Bin parameters for `binCount` bins over `[min, max]`, or `null` when no
 * histogram is meaningful: no rows, or a constant column (min === max).
 */
export function binParams(stats: Stats | null, binCount: number): BinParams | null {
  if (!stats || stats.count === 0) return null;
  if (stats.min === stats.max) return null;
  return { binStart: stats.min, binSize: (stats.max - stats.min) / binCount };
}

/** Brush endpoints → an isBetween filter on the field; null if degenerate (no width). */
export function histogramBrushPredicate(field: string, a: number, b: number): FilterClause | null {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  if (!(lo < hi)) return null;
  return { op: "between", column: field, range: [lo, hi] };
}
