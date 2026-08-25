/**
 * Starting parameters for a feature nobody has tuned yet, and — more importantly — valid
 * parameters for a shape the user has just switched TO.
 *
 * The four shapes do not share a parameter vocabulary: `gaussian` wants `center`/`fwhm`,
 * `linear`+`higher` wants `onset`/`ideal`, `sigmoid`+`target` wants a half-band. Carrying the
 * old keys across a shape change would hand `curveBounds` an object full of `undefined`,
 * which reads as NaN bounds and paints a blank plot. So a shape or direction change
 * regenerates params from the DATA, which also puts the curve somewhere useful instead of at
 * whatever coordinates the previous shape happened to occupy.
 *
 * Every default here is chosen to satisfy the invariants `curveBounds` enforces — `fwhm > 0`,
 * `fold > 1`, `center > 0` for lognormal — for any input distribution, including a feature
 * whose values are all identical or all negative. `defaults.test.ts` pins that.
 */

import type { CurveParams, Direction, FeatureSpec, Shape } from "./desirability";

export interface FeatureStats {
  /** Finite-value extent. Equals [0, 1] when nothing is measurable. */
  lo: number;
  hi: number;
  q25: number;
  median: number;
  q75: number;
  /** Rows whose value is not finite. */
  missing: number;
}

const EMPTY_STATS: FeatureStats = { lo: 0, hi: 1, q25: 0.25, median: 0.5, q75: 0.75, missing: 0 };

/** Linear-interpolated quantile, matching numpy's default so figures agree with the Python. */
function quantile(sorted: readonly number[], p: number): number {
  const pos = (sorted.length - 1) * p;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export function featureStats(values: readonly number[]): FeatureStats {
  const finite = values.filter((v) => Number.isFinite(v)).toSorted((a, b) => a - b);
  const missing = values.length - finite.length;
  if (finite.length === 0) return { ...EMPTY_STATS, missing };
  return {
    lo: finite[0],
    hi: finite[finite.length - 1],
    q25: quantile(finite, 0.25),
    median: quantile(finite, 0.5),
    q75: quantile(finite, 0.75),
    missing,
  };
}

/**
 * A non-zero scale for the feature.
 *
 * Falls back to the magnitude of the values rather than to 1 when every value is identical:
 * a constant feature at 5000 needs a width near 5000, not near 1, or its curve is a spike
 * far narrower than a pixel.
 */
function scaleOf(s: FeatureStats): { span: number; iqr: number } {
  const extent = s.hi - s.lo;
  const span = extent > 0 ? extent : Math.max(Math.abs(s.hi), Math.abs(s.lo), 1);
  const gap = s.q75 - s.q25;
  return { span, iqr: gap > 0 ? gap : span / 4 };
}

/** Params for `shape`/`direction` placed over the data. Always passes `curveBounds`. */
export function defaultParams(shape: Shape, direction: Direction, s: FeatureStats): CurveParams {
  const { span, iqr } = scaleOf(s);

  if (shape === "gaussian") return { center: s.median, fwhm: iqr };

  if (shape === "lognormal") {
    // `center > 0` is a hard requirement, and the shape is meaningless on a feature that
    // straddles or sits below zero. Pick the largest positive anchor available so the curve
    // at least lands on real data when there is any, rather than refusing to render.
    const positive = [s.median, s.q75, s.hi].find((v) => v > 0);
    return { center: positive ?? 1, fold: 2 };
  }

  if (shape === "sigmoid") {
    if (direction === "target") {
      const lo = s.q25;
      const hi = s.q75 > s.q25 ? s.q75 : s.q25 + span / 10;
      return { half_band_lo: lo, half_band_hi: hi, width: span / 10 };
    }
    return { midpoint: s.median, width: iqr };
  }

  if (direction === "target") {
    const lo = s.q25;
    const hi = s.q75 > s.q25 ? s.q75 : s.q25 + span / 10;
    return { range_lo: lo, range_hi: hi, soft_left: iqr, soft_right: iqr };
  }
  // `onset` is where desirability starts leaving zero and `ideal` where it reaches one, so
  // "lower is better" runs the pair backwards down the axis.
  return direction === "higher" ? { onset: s.lo, ideal: s.hi } : { onset: s.hi, ideal: s.lo };
}

/**
 * An untuned feature: a bell on the middle half of its own distribution.
 *
 * Enabled, not disabled. Opening the dashboard with every feature off would show a score of
 * zero for every FOV and an accuracy of zero — indistinguishable from a broken tool. A
 * "prefer typical" baseline gives a real number to tune away from, and turning a feature OFF
 * is then a deliberate act with a visible effect on the readout.
 */
export function defaultSpec(s: FeatureStats): FeatureSpec {
  return {
    shape: "gaussian",
    direction: "target",
    params: defaultParams("gaussian", "target", s),
    weight: 1,
    enabled: true,
  };
}
