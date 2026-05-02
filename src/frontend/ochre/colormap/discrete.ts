import type { Srgb } from "../color/types";
import type { DiscreteColormap } from "./types";

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

export interface DiscreteColormapOptions {
  readonly name: string;
  readonly colors: readonly Srgb[];
}

export function discreteColormap(opts: DiscreteColormapOptions): DiscreteColormap {
  const colors = opts.colors;
  const name = opts.name;

  const map = (t: number): Srgb => {
    if (colors.length === 0) return { r: 0, g: 0, b: 0, alpha: 1 };
    const n = colors.length;
    const idx = Math.min(Math.floor(clamp01(t) * n), n - 1);
    return colors[idx];
  };

  return { kind: "discrete", name, colors, map };
}
