import { okLabToSrgb, okLchToSrgb, srgbToOkLab, srgbToOkLch } from "../color/convert";
import { linearRgbToSrgb, srgbToLinearRgb } from "../color/linear-rgb";
import type { ColorSpace, Srgb } from "../color/types";
import type { ColorStop, LinearColormap } from "./types";

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const lerp = (a: number, b: number, t: number) => a + t * (b - a);

export interface LinearColormapOptions {
  readonly name: string;
  readonly stops: readonly ColorStop[];
  readonly interpolation?: ColorSpace;
}

export function linearColormap(opts: LinearColormapOptions): LinearColormap {
  const stops = [...opts.stops].toSorted((x, y) => x.position - y.position);
  const interpolation = opts.interpolation ?? "oklab";
  const name = opts.name;

  const map = (raw: number): Srgb => {
    const t = clamp01(raw);
    if (stops.length === 0) return { r: 0, g: 0, b: 0, alpha: 1 };
    if (stops.length === 1) return stops[0].color;
    if (t <= stops[0].position) return stops[0].color;
    const last = stops[stops.length - 1];
    if (t >= last.position) return last.color;

    for (let i = 0; i < stops.length - 1; i++) {
      const lo = stops[i];
      const hi = stops[i + 1];
      if (t >= lo.position && t <= hi.position) {
        const span = hi.position - lo.position;
        const frac = span < Number.EPSILON ? 0 : (t - lo.position) / span;
        return interpolate(lo.color, hi.color, frac, interpolation);
      }
    }
    return last.color;
  };

  return { kind: "linear", name, stops, interpolation, map };
}

export function twoColorColormap(
  name: string,
  start: Srgb,
  end: Srgb,
  interpolation: ColorSpace = "oklab",
): LinearColormap {
  return linearColormap({
    name,
    stops: [
      { position: 0, color: start },
      { position: 1, color: end },
    ],
    interpolation,
  });
}

function interpolate(a: Srgb, b: Srgb, t: number, space: ColorSpace): Srgb {
  switch (space) {
    case "srgb":
      return {
        r: lerp(a.r, b.r, t),
        g: lerp(a.g, b.g, t),
        b: lerp(a.b, b.b, t),
        alpha: lerp(a.alpha, b.alpha, t),
      };
    case "linearRgb": {
      const al = srgbToLinearRgb(a);
      const bl = srgbToLinearRgb(b);
      return linearRgbToSrgb({
        r: lerp(al.r, bl.r, t),
        g: lerp(al.g, bl.g, t),
        b: lerp(al.b, bl.b, t),
        alpha: lerp(al.alpha, bl.alpha, t),
      });
    }
    case "oklab": {
      const al = srgbToOkLab(a);
      const bl = srgbToOkLab(b);
      return okLabToSrgb({
        l: lerp(al.l, bl.l, t),
        a: lerp(al.a, bl.a, t),
        b: lerp(al.b, bl.b, t),
        alpha: lerp(al.alpha, bl.alpha, t),
      });
    }
    case "oklch": {
      const al = srgbToOkLch(a);
      const bl = srgbToOkLch(b);
      let dh = bl.h - al.h;
      if (dh > 180) dh -= 360;
      else if (dh < -180) dh += 360;
      const h = (((al.h + t * dh) % 360) + 360) % 360;
      return okLchToSrgb({
        l: lerp(al.l, bl.l, t),
        c: lerp(al.c, bl.c, t),
        h,
        alpha: lerp(al.alpha, bl.alpha, t),
      });
    }
    default: {
      const _exhaustive: never = space;
      throw new Error(`unknown color space: ${String(_exhaustive)}`);
    }
  }
}

export function mapBatch(cmap: { map(t: number): Srgb }, values: ArrayLike<number>): Srgb[] {
  const out: Srgb[] = Array.from({ length: values.length });
  for (let i = 0; i < values.length; i++) out[i] = cmap.map(values[i]);
  return out;
}

export function mapBatchFlat(
  cmap: { map(t: number): Srgb },
  values: ArrayLike<number>,
  out?: Float32Array,
): Float32Array {
  const buf = out ?? new Float32Array(values.length * 4);
  for (let i = 0; i < values.length; i++) {
    const c = cmap.map(values[i]);
    const o = i * 4;
    buf[o] = c.r;
    buf[o + 1] = c.g;
    buf[o + 2] = c.b;
    buf[o + 3] = c.alpha;
  }
  return buf;
}
