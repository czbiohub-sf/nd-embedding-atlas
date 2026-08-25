/**
 * Direct manipulation of a desirability curve: which points you can grab, and what dragging
 * one does to the interpretable parameters.
 *
 * Kept out of the SVG deliberately. This is where the invariants live — `fwhm > 0`,
 * `fold > 1`, a band whose edges cannot cross — and a dragged handle that violates one would
 * throw from `curveBounds` mid-gesture. Clamping here means the curve deforms up to its limit
 * and stops, instead of the plot going blank because the pointer moved one pixel too far.
 *
 * Handle positions are in DATA space (x = feature value, y = desirability 0..1), so the plot
 * only has to apply its own scales.
 */

import type { CurveParams, Direction, Shape } from "./desirability";

export interface CurveHandle {
  /** Which parameter this handle edits; also its React key. */
  key: string;
  /** Feature-value position. */
  x: number;
  /** Desirability position, 0..1 — where on the curve the handle visually sits. */
  y: number;
  /** What dragging it does, for the cursor and the tooltip. */
  kind: "centre" | "width" | "edge";
  label: string;
}

/** Smallest width/tolerance a drag may produce, as a fraction of the plotted domain. */
const MIN_SPAN_FRACTION = 1e-3;

/**
 * The grabbable points for one curve.
 *
 * Centre handles sit at the peak, width handles at the half-maximum crossing — so the thing
 * you grab is the thing the parameter means.
 */
export function curveHandles(shape: Shape, direction: Direction, params: CurveParams): CurveHandle[] {
  if (shape === "gaussian") {
    return [
      { key: "center", x: params.center, y: 1, kind: "centre", label: "centre" },
      { key: "fwhm", x: params.center + params.fwhm / 2, y: 0.5, kind: "width", label: "FWHM" },
    ];
  }
  if (shape === "lognormal") {
    return [
      { key: "center", x: params.center, y: 1, kind: "centre", label: "centre" },
      { key: "fold", x: params.center * params.fold, y: 0.5, kind: "width", label: "fold" },
    ];
  }
  if (shape === "sigmoid") {
    if (direction === "target") {
      return [
        { key: "half_band_lo", x: params.half_band_lo, y: 0.5, kind: "edge", label: "band lo" },
        { key: "half_band_hi", x: params.half_band_hi, y: 0.5, kind: "edge", label: "band hi" },
      ];
    }
    return [
      { key: "midpoint", x: params.midpoint, y: 0.5, kind: "centre", label: "midpoint" },
      { key: "width", x: params.midpoint + params.width / 2, y: 0.9, kind: "width", label: "width" },
    ];
  }
  if (direction === "target") {
    return [
      { key: "range_lo", x: params.range_lo, y: 1, kind: "edge", label: "range lo" },
      { key: "range_hi", x: params.range_hi, y: 1, kind: "edge", label: "range hi" },
      { key: "soft_left", x: params.range_lo - params.soft_left, y: 0, kind: "width", label: "left shoulder" },
      { key: "soft_right", x: params.range_hi + params.soft_right, y: 0, kind: "width", label: "right shoulder" },
    ];
  }
  return [
    { key: "onset", x: params.onset, y: 0, kind: "edge", label: "onset" },
    { key: "ideal", x: params.ideal, y: 1, kind: "edge", label: "ideal" },
  ];
}

/**
 * Apply a drag: the handle `key` was released at feature value `x`.
 *
 * Returns a new params object; the original is untouched so a caller can diff or discard.
 * `domain` is the plotted extent, used only to size the minimum span — a curve is allowed to
 * be narrower than the data, but not zero-width, which would divide by zero downstream.
 */
export function dragHandle(
  shape: Shape,
  direction: Direction,
  params: CurveParams,
  key: string,
  x: number,
  domain: readonly [number, number],
): CurveParams {
  const next = { ...params };
  const minSpan = Math.max(Math.abs(domain[1] - domain[0]) * MIN_SPAN_FRACTION, Number.MIN_VALUE);

  if (shape === "gaussian") {
    if (key === "center") next.center = x;
    // The handle marks center + fwhm/2, so the width follows the distance dragged, mirrored:
    // grabbing the right shoulder and pulling left past the centre widens rather than inverts.
    else if (key === "fwhm") next.fwhm = Math.max(2 * Math.abs(x - params.center), minSpan);
    return next;
  }

  if (shape === "lognormal") {
    if (key === "center") {
      // The support is x > 0; a lognormal centred at or below zero has no meaning.
      next.center = Math.max(x, minSpan);
    } else if (key === "fold") {
      // fold is multiplicative and must exceed 1, else the curve has no width at all.
      const ratio = params.center > 0 ? Math.abs(x) / params.center : 1;
      next.fold = Math.max(ratio, 1 + MIN_SPAN_FRACTION);
    }
    return next;
  }

  if (shape === "sigmoid") {
    if (direction === "target") {
      if (key === "half_band_lo") next.half_band_lo = Math.min(x, params.half_band_hi - minSpan);
      else if (key === "half_band_hi") next.half_band_hi = Math.max(x, params.half_band_lo + minSpan);
      return next;
    }
    if (key === "midpoint") next.midpoint = x;
    else if (key === "width") next.width = Math.max(2 * Math.abs(x - params.midpoint), minSpan);
    return next;
  }

  if (direction === "target") {
    if (key === "range_lo") next.range_lo = Math.min(x, params.range_hi - minSpan);
    else if (key === "range_hi") next.range_hi = Math.max(x, params.range_lo + minSpan);
    // Shoulders are widths measured outward from the band, so they cannot be negative.
    else if (key === "soft_left") next.soft_left = Math.max(params.range_lo - x, 0);
    else if (key === "soft_right") next.soft_right = Math.max(x - params.range_hi, 0);
    return next;
  }

  // Linear monotonic: onset and ideal may sit either way round (that IS the direction), so
  // they only need to stay distinct.
  if (key === "onset") {
    next.onset =
      Math.abs(x - params.ideal) < minSpan ? params.ideal + Math.sign(params.onset - params.ideal || 1) * minSpan : x;
  } else if (key === "ideal") {
    next.ideal =
      Math.abs(x - params.onset) < minSpan ? params.onset + Math.sign(params.ideal - params.onset || 1) * minSpan : x;
  }
  return next;
}
