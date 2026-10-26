/**
 * Named colormaps as hex palettes and GPU LUTs.
 *
 * The catalog: a curated set of categorical palettes (discrete maps plus
 * glasbey) and every linear colormap from every source (~300). On a name
 * collision between linear sources the first source wins and later ones are
 * prefixed (`matplotlib:twilight`).
 */

import { srgbToHex } from "./color";
import * as bids from "./colormap/catalog/bids";
import * as chrisluts from "./colormap/catalog/chrisluts";
import * as cividis from "./colormap/catalog/cividis";
import * as cmasher from "./colormap/catalog/cmasher";
import * as cmocean from "./colormap/catalog/cmocean";
import * as colorbrewer from "./colormap/catalog/colorbrewer";
import * as colorcet from "./colormap/catalog/colorcet";
import * as contrib from "./colormap/catalog/contrib";
import * as crameri from "./colormap/catalog/crameri";
import { glasbey } from "./colormap/catalog/glasbey";
import * as google from "./colormap/catalog/google";
import * as ibm from "./colormap/catalog/ibm";
import * as imagej from "./colormap/catalog/imagej";
import * as matlab from "./colormap/catalog/matlab";
import * as matplotlib from "./colormap/catalog/matplotlib";
import * as napari from "./colormap/catalog/napari";
import * as observable from "./colormap/catalog/observable";
import { okabeito } from "./colormap/catalog/okabeito";
import * as paraview from "./colormap/catalog/paraview";
import { petroff10, petroff6, petroff8 } from "./colormap/catalog/petroff";
import * as seaborn from "./colormap/catalog/seaborn";
import { tab10, tab20, tab20b, tab20c } from "./colormap/catalog/tableau";
import * as tol from "./colormap/catalog/tol";
import * as vispy from "./colormap/catalog/vispy";
import * as yorick from "./colormap/catalog/yorick";
import type { DiscreteColormap, LinearColormap } from "./colormap/types";

type NamedColormap = LinearColormap | DiscreteColormap;

const { Accent, Dark2, Paired, Pastel1, Pastel2, Set1, Set2, Set3 } = colorbrewer;

/** Curated categorical palettes, in picker order. `Category10` is matplotlib's classic tab10. */
export const categoricalColormaps: Readonly<Record<string, NamedColormap>> = {
  Category10: tab10,
  tab20,
  tab20b,
  tab20c,
  Set1,
  Set2,
  Set3,
  Paired,
  Dark2,
  Accent,
  Pastel1,
  Pastel2,
  okabeito,
  petroff6,
  petroff8,
  petroff10,
  glasbey,
};

// Ordered by preference: earlier sources win on name collision.
const LINEAR_SOURCES: (readonly [string, Record<string, unknown>])[] = [
  ["bids", bids],
  ["colorbrewer", colorbrewer],
  ["cmocean", cmocean],
  ["crameri", crameri],
  ["matplotlib", matplotlib],
  ["colorcet", colorcet],
  ["cmasher", cmasher],
  ["paraview", paraview],
  ["seaborn", seaborn],
  ["tol", tol],
  ["vispy", vispy],
  ["observable", observable],
  ["ibm", ibm],
  ["matlab", matlab],
  ["napari", napari],
  ["imagej", imagej],
  ["yorick", yorick],
  ["chrisluts", chrisluts],
  ["contrib", contrib],
  ["cividis", cividis],
  ["google", google],
];

function isLinear(value: unknown): value is LinearColormap {
  return (value as { kind?: unknown } | null)?.kind === "linear";
}

/** Every linear colormap in the catalog, in source order. */
export const continuousColormaps: Readonly<Record<string, LinearColormap>> = (() => {
  const acc: Record<string, LinearColormap> = {};
  for (const [source, ns] of LINEAR_SOURCES) {
    for (const [key, value] of Object.entries(ns)) {
      if (isLinear(value)) acc[key in acc ? `${source}:${key}` : key] = value;
    }
  }
  return acc;
})();

/** The colormap a catalog name refers to, or null for an unknown name. */
export function resolveColormap(name: string): NamedColormap | null {
  return continuousColormaps[name] ?? categoricalColormaps[name] ?? null;
}

function grayscale(n: number): string[] {
  if (n === 1) return ["#808080"];
  return Array.from({ length: n }, (_, i) => {
    const hex = Math.round((i / (n - 1)) * 255)
      .toString(16)
      .padStart(2, "0");
    return `#${hex}${hex}${hex}`.toUpperCase();
  });
}

function sample(cmap: NamedColormap, n: number): string[] {
  if (cmap.kind === "discrete") {
    const { colors } = cmap;
    if (colors.length === 0) return grayscale(n);
    return Array.from({ length: n }, (_, i) => srgbToHex(colors[i % colors.length]));
  }
  if (n === 1) return [srgbToHex(cmap.map(0.5))];
  return Array.from({ length: n }, (_, i) => srgbToHex(cmap.map(i / (n - 1))));
}

const paletteCache = new Map<string, string[]>();

/**
 * `n` hex colors from a named colormap: discrete maps cycle past their
 * length, linear maps are sampled at `n` evenly spaced points, an unknown name
 * is grayscale. Arrays are referentially stable per (name, n), so they are
 * safe in React dependency lists.
 */
export function samplePalette(name: string, n: number): string[] {
  const key = `${name}\u0000${n}`;
  let out = paletteCache.get(key);
  if (!out) {
    const cmap = resolveColormap(name);
    out = n === 0 ? [] : cmap ? sample(cmap, n) : grayscale(n);
    paletteCache.set(key, out);
  }
  return out;
}

const byte = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255)));

/**
 * A `size`-entry packed RGBA LUT (`R | G<<8 | B<<16 | A<<24`, ready for a
 * `d.arrayOf(d.u32, size)` buffer) sampled forward over `t ∈ [0, 1]`; an
 * unknown name is a grayscale ramp. Reversal is the consumer's job.
 */
export function buildLut(name: string, size = 256): Uint32Array {
  const cmap = resolveColormap(name);
  const out = new Uint32Array(size);
  for (let i = 0; i < size; i++) {
    const t = i / (size - 1);
    const c = cmap ? cmap.map(t) : { r: t, g: t, b: t, alpha: 1 };
    out[i] = (byte(c.r) | (byte(c.g) << 8) | (byte(c.b) << 16) | (byte(c.alpha) << 24)) >>> 0;
  }
  return out;
}
