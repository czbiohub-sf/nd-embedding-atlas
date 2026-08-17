import { discreteColormap } from "./discrete";
import { linearColormap } from "./linear";
import type { ColorMap, DiscreteColormap, LinearColormap } from "./types";

/** Reverse a linear colormap (flip direction by mirroring stop positions). */
export function reverseLinear(cmap: LinearColormap): LinearColormap {
  return linearColormap({
    name: `${cmap.name}_r`,
    stops: cmap.stops.map((s) => ({ position: 1 - s.position, color: s.color })),
    interpolation: cmap.interpolation,
  });
}

/** Reverse a discrete colormap (flip color order). */
export function reverseDiscrete(cmap: DiscreteColormap): DiscreteColormap {
  return discreteColormap({ name: `${cmap.name}_r`, colors: [...cmap.colors].toReversed() });
}

/** Generic reverse that works on any ColorMap. Preserves kind when possible. */
export function reverse(cmap: LinearColormap): LinearColormap;
export function reverse(cmap: DiscreteColormap): DiscreteColormap;
export function reverse(cmap: ColorMap): ColorMap;
export function reverse(cmap: ColorMap): ColorMap {
  if ("kind" in cmap) {
    if (cmap.kind === "linear") return reverseLinear(cmap as LinearColormap);
    if (cmap.kind === "discrete") return reverseDiscrete(cmap as DiscreteColormap);
  }
  return { name: `${cmap.name}_r`, map: (t) => cmap.map(1 - t) };
}

/**
 * Restrict a colormap to a sub-range [t0, t1] ⊂ [0, 1].
 * The returned cmap's input [0, 1] samples the original over [t0, t1].
 */
export function slice(cmap: ColorMap, t0: number, t1: number): ColorMap {
  const span = t1 - t0;
  return {
    name: `${cmap.name}[${t0}..${t1}]`,
    map: (t) => cmap.map(t0 + t * span),
  };
}
