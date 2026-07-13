import { srgbFromHex } from "../color/srgb";
import type { ColorSpace, Srgb } from "../color/types";
import { discreteColormap } from "./discrete";
import { linearColormap } from "./linear";
import type { ColorStop, DiscreteColormap, LinearColormap } from "./types";

/** Turn a hex list into evenly-spaced ColorStops in [0, 1]. */
export function evenStops(hexes: readonly string[]): ColorStop[] {
  const n = hexes.length;
  return hexes.map((hex, i) => ({
    position: n <= 1 ? 0 : i / (n - 1),
    color: srgbFromHex(hex),
  }));
}

/** Pair explicit positions with hex colors. */
export function positionedStops(entries: readonly (readonly [number, string])[]): ColorStop[] {
  return entries.map(([position, hex]) => ({ position, color: srgbFromHex(hex) }));
}

export interface LinearFromHexesOptions {
  readonly name: string;
  readonly hexes: readonly string[];
  readonly positions?: readonly number[];
  readonly interpolation?: ColorSpace;
}

/** Build a LinearColormap from a hex list (evenly spaced unless positions given). */
export function linearFromHexes(opts: LinearFromHexesOptions): LinearColormap {
  const stops = opts.positions
    ? positionedStops(opts.hexes.map((h, i) => [opts.positions![i], h] as const))
    : evenStops(opts.hexes);
  return linearColormap({ name: opts.name, stops, interpolation: opts.interpolation });
}

/** Build a DiscreteColormap from a hex list. */
export function discreteFromHexes(name: string, hexes: readonly string[]): DiscreteColormap {
  return discreteColormap({ name, colors: hexes.map((h) => srgbFromHex(h)) });
}

/** Build a DiscreteColormap from a flat RGB LUT (values in [0, 1]). */
export function discreteFromRgbLut(name: string, lut: ArrayLike<number>): DiscreteColormap {
  if (lut.length % 3 !== 0) throw new Error(`lut length must be multiple of 3, got ${lut.length}`);
  const n = lut.length / 3;
  const colors: Srgb[] = Array.from({ length: n });
  for (let i = 0; i < n; i++) {
    const o = i * 3;
    colors[i] = { r: lut[o], g: lut[o + 1], b: lut[o + 2], alpha: 1 };
  }
  return discreteColormap({ name, colors });
}

export interface LinearFromLutOptions {
  readonly name: string;
  /** Flat RGB triples in [0, 1] sRGB. `lut.length` must be divisible by 3. */
  readonly lut: ArrayLike<number>;
  readonly interpolation?: ColorSpace;
}

/**
 * Build a LinearColormap from a flat RGB LUT (e.g. matplotlib's 256-entry
 * `_viridis_data`). Stops are evenly spaced across [0, 1].
 */
export function linearFromLut(opts: LinearFromLutOptions): LinearColormap {
  const { lut } = opts;
  if (lut.length % 3 !== 0) throw new Error(`lut length must be multiple of 3, got ${lut.length}`);
  const n = lut.length / 3;
  if (n < 2) throw new Error(`lut needs >= 2 entries, got ${n}`);

  const stops: ColorStop[] = Array.from({ length: n });
  for (let i = 0; i < n; i++) {
    const o = i * 3;
    stops[i] = {
      position: i / (n - 1),
      color: { r: lut[o], g: lut[o + 1], b: lut[o + 2], alpha: 1 },
    };
  }
  return linearColormap({ name: opts.name, stops, interpolation: opts.interpolation });
}
