/**
 * The embedding's colormap picker over `@ndea/ochre/palette`: picker order,
 * the default categorical palette, and the name "tab10".
 */

import type { ColormapList } from "@ndea/components/scatter";
import { categoricalColormaps, continuousColormaps, samplePalette } from "@ndea/ochre/palette";

// "tab10" is d3's schemeTableau10 (Tableau's refreshed palette, `#4e79a7…`),
// the colors users have always seen under that name; ochre's matplotlib-classic
// tab10 (`#1f77b4…`) is listed as "Category10".
const TABLEAU10_HEX: readonly string[] = [
  "#4E79A7",
  "#F28E2C",
  "#E15759",
  "#76B7B2",
  "#59A14F",
  "#EDC949",
  "#AF7AA1",
  "#FF9DA7",
  "#9C755F",
  "#BAB0AB",
];

/**
 * Pick a reasonable default categorical palette for `n` categories.
 * - ≤10 → tab10 (Tableau10, widely recognized)
 * - ≤12 → Paired (qualitative, maximally distinct)
 * - ≤20 → tab20
 * - >20 → glasbey (designed for many categories, up to 256)
 */
export function pickDefaultCategoricalPalette(n: number): string {
  if (n <= 10) return "tab10";
  if (n <= 12) return "Paired";
  if (n <= 20) return "tab20";
  return "glasbey";
}

const COLORMAP_LIST: ColormapList = {
  categorical: ["tab10", ...Object.keys(categoricalColormaps)],
  continuous: Object.keys(continuousColormaps),
};

/** Every colormap name in picker order; one stable object. */
export function getColormapList(): ColormapList {
  return COLORMAP_LIST;
}

const tab10Cache = new Map<number, string[]>();

/** `n` hex colors for a named colormap, referentially stable per (name, n). */
export function getCategoricalPalette(name: string, n: number): string[] {
  if (name !== "tab10") return samplePalette(name, n);
  let out = tab10Cache.get(n);
  if (!out) {
    out = Array.from({ length: n }, (_, i) => TABLEAU10_HEX[i % TABLEAU10_HEX.length]);
    tab10Cache.set(n, out);
  }
  return out;
}
