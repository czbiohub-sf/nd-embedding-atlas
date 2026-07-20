/**
 * Generic linear scale helpers for the range-annotation bracket.
 *
 * No metric-specific assumptions (no log axis, no fixed regularization window):
 * the domain auto-fits the current [lo, hi] with padding, so the slider works
 * for any numeric metric. The caller freezes the domain during a drag so the
 * axis doesn't slide under the cursor.
 */

export type Domain = [min: number, max: number];

export const clamp01 = (t: number): number => Math.min(1, Math.max(0, t));

/** Round x toward -∞ / +∞ at one significant figure: for tidy axis bounds. */
function niceRound(x: number, dir: "floor" | "ceil"): number {
  if (x === 0) return 0;
  const mag = 10 ** Math.floor(Math.log10(Math.abs(x)));
  return (dir === "floor" ? Math.floor : Math.ceil)(x / mag) * mag;
}

/** A padded, tidy [min, max] domain that comfortably contains lo/hi. */
export function niceDomain(lo: number | null, hi: number | null): Domain {
  const vals = [lo, hi].filter((v): v is number => v != null && Number.isFinite(v));
  if (vals.length === 0) return [0, 1];
  let a = Math.min(...vals);
  let b = Math.max(...vals);
  if (a === b) {
    const p = Math.abs(a) || 1;
    a -= p;
    b += p;
  }
  const pad = (b - a) * 0.4;
  // A metric that's non-negative so far shouldn't let the axis dip below 0.
  const lower = a >= 0 ? Math.max(0, a - pad) : a - pad;
  return [niceRound(lower, "floor"), niceRound(b + pad, "ceil")];
}

/** value → [0,1] position within the domain (clamped). */
export const posOf = (v: number, [d0, d1]: Domain): number => (d1 === d0 ? 0 : clamp01((v - d0) / (d1 - d0)));

/** [0,1] position → value within the domain. */
export const valOf = (t: number, [d0, d1]: Domain): number => d0 + clamp01(t) * (d1 - d0);

/** n evenly-spaced tick values across the domain (inclusive of both ends). */
export function domainTicks([d0, d1]: Domain, n = 5): number[] {
  return Array.from({ length: n }, (_, i) => d0 + ((d1 - d0) * i) / (n - 1));
}

/** Compact, generic number formatting: scientific only at the extremes. */
export function fmtVal(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "";
  if (v === 0) return "0";
  const a = Math.abs(v);
  if (a >= 1e4 || a < 1e-3) return v.toExponential(1);
  return String(Number(v.toPrecision(3)));
}

/** Parse a field to a finite number (any sign), or null. */
export function parseVal(s: string): number | null {
  const t = s.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}
