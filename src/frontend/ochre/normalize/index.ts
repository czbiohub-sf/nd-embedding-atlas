import type { Srgb } from "../color/types";
import type { ColorMap } from "../colormap/types";

export type Normalizer = (value: number) => number;

export interface Bounds {
  readonly min: number;
  readonly max: number;
}

/**
 * Bind a normalizer to a colormap, producing a new colormap that accepts
 * raw data values instead of pre-normalized [0, 1].
 */
export function normalized(cmap: ColorMap, normalizer: Normalizer): ColorMap {
  return {
    name: cmap.name,
    map: (v: number): Srgb => cmap.map(normalizer(v)),
  };
}

/** Linear: [min, max] → [0, 1], clamped. */
export function linearNormalizer(min: number, max: number): Normalizer {
  const span = max - min;
  if (span < Number.EPSILON) return () => 0;
  return (v) => {
    const t = (v - min) / span;
    return t < 0 ? 0 : t > 1 ? 1 : t;
  };
}

/** Log: [min, max] → [0, 1] on log scale. Requires min > 0. */
export function logNormalizer(min: number, max: number): Normalizer {
  if (min <= 0) throw new Error(`logNormalizer requires min > 0, got ${min}`);
  if (max <= min) throw new Error(`logNormalizer requires max > min`);
  const lmin = Math.log(min);
  const span = Math.log(max) - lmin;
  return (v) => {
    if (v <= 0) return 0;
    const t = (Math.log(v) - lmin) / span;
    return t < 0 ? 0 : t > 1 ? 1 : t;
  };
}

/** Symmetric log: maps a signed range to [0, 1] with `linthresh` linear around 0. */
export function symLogNormalizer(vmin: number, vmax: number, linthresh: number): Normalizer {
  if (linthresh <= 0) throw new Error("symLogNormalizer: linthresh must be > 0");
  const tf = (v: number) =>
    Math.abs(v) <= linthresh ? v / linthresh : Math.sign(v) * (1 + Math.log(Math.abs(v) / linthresh));
  const t0 = tf(vmin);
  const t1 = tf(vmax);
  const span = t1 - t0;
  if (span < Number.EPSILON) return () => 0.5;
  return (v) => {
    const t = (tf(v) - t0) / span;
    return t < 0 ? 0 : t > 1 ? 1 : t;
  };
}

/**
 * Diverging: maps [vmin, vmax] → [0, 1] with `center` pinned to 0.5.
 * Useful for diverging colormaps (RdBu, coolwarm, etc.).
 */
export function divergingNormalizer(vmin: number, vmax: number, center = 0): Normalizer {
  const below = center - vmin;
  const above = vmax - center;
  if (below <= 0 && above <= 0) return () => 0.5;
  return (v) => {
    if (v === center) return 0.5;
    if (v < center) {
      if (below <= 0) return 0;
      const t = 0.5 * (1 - (center - v) / below);
      return t < 0 ? 0 : t;
    }
    if (above <= 0) return 1;
    const t = 0.5 + 0.5 * ((v - center) / above);
    return t > 1 ? 1 : t;
  };
}

/** Compute min/max of a numeric array (ignoring NaN). */
export function bounds(values: ArrayLike<number>): Bounds {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (Number.isNaN(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: 1 };
  return { min, max };
}

/** Percentile-based bounds for robust scaling (e.g. pLo=2, pHi=98). */
export function percentileBounds(values: ArrayLike<number>, pLo: number, pHi: number): Bounds {
  if (pLo < 0 || pHi > 100 || pLo >= pHi) {
    throw new Error(`invalid percentiles: [${pLo}, ${pHi}]`);
  }
  const filtered: number[] = [];
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (!Number.isNaN(v)) filtered.push(v);
  }
  if (filtered.length === 0) return { min: 0, max: 1 };
  filtered.sort((a, b) => a - b);
  const pick = (p: number) => {
    const idx = (p / 100) * (filtered.length - 1);
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    if (lo === hi) return filtered[lo];
    return filtered[lo] + (filtered[hi] - filtered[lo]) * (idx - lo);
  };
  return { min: pick(pLo), max: pick(pHi) };
}
