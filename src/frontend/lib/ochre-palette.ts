/**
 * Frontend source of truth for colormap names + palette generation.
 *
 * Phase 8: replaces `/data/colormaps` + `/data/categorical-palette` backend
 * endpoints. Everything is synchronous — ochre's catalog is bundled, and
 * palette generation is tens of µs even at n=256.
 *
 * Import narrowly (named, not `import * as catalog`) so the bundler can
 * tree-shake unused colormap modules.
 */

import { tab10 as OchreTab10 } from "@/ochre/colormap/catalog/tableau";
import {
  Accent,
  Blues,
  Dark2,
  Greens,
  Greys,
  Oranges,
  Paired,
  Pastel1,
  Pastel2,
  RdBu,
  RdYlBu,
  Reds,
  Set1,
  Set2,
  Set3,
  Spectral,
} from "@/ochre/colormap/catalog/colorbrewer";
import { cividis, coolwarm, inferno, magma, plasma, turbo, viridis } from "@/ochre/colormap/popular";
import { srgbToHex } from "@/ochre/color/srgb";
import type { ColorMap, DiscreteColormap, LinearColormap } from "@/ochre/colormap/types";

// ─── Vendored d3 Tableau10 (refreshed tableau palette) ──────────────────────
// Ochre's `tab10` maps to matplotlib-classic Category10 (`#1f77b4...`), but
// d3-scale-chromatic's `schemeTableau10` — which our backend has been serving
// for the name "tab10" — uses Tableau's refreshed palette (`#4e79a7...`).
// To preserve the exact colors users see today, we vendor the d3 hex array
// under the name "tab10" and alias "Category10" to ochre's matplotlib-classic.
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

// ─── Name → ochre ColorMap ──────────────────────────────────────────────────

const CATEGORICAL_CMAPS: Record<string, DiscreteColormap> = {
  // "tab10" handled separately via TABLEAU10_HEX — see buildCategoricalHex.
  Category10: OchreTab10,
  Set1,
  Set2,
  Set3,
  Paired,
  Dark2,
  Accent,
  Pastel1,
  Pastel2,
};

const CONTINUOUS_CMAPS: Record<string, LinearColormap> = {
  viridis,
  plasma,
  magma,
  inferno,
  cividis,
  turbo,
  coolwarm,
  Greys,
  Blues,
  Greens,
  Oranges,
  Reds,
  RdBu,
  RdYlBu,
  Spectral,
};

// Explicit name lists (ordered for picker display).
const CATEGORICAL_NAMES: readonly string[] = [
  "tab10",
  "Category10",
  ...Object.keys(CATEGORICAL_CMAPS).filter((n) => n !== "Category10"),
];
const CONTINUOUS_NAMES: readonly string[] = Object.keys(CONTINUOUS_CMAPS);

export interface ColormapList {
  categorical: string[];
  continuous: string[];
}

// ─── Public API ─────────────────────────────────────────────────────────────

let cachedList: ColormapList | null = null;

/** Stable (referentially memoized) list of all available colormap names. */
export function getColormapList(): ColormapList {
  cachedList ??= { categorical: [...CATEGORICAL_NAMES], continuous: [...CONTINUOUS_NAMES] };
  return cachedList;
}

// Referential-identity cache per (name, n). Keeps React re-renders stable:
// when ColormapGrid or ContinuousLegend rebuild, they get the same array
// reference and skip downstream work gated on Object.is equality.
const paletteCache = new Map<string, string[]>();

function paletteCacheKey(name: string, n: number): string {
  return `${name}\u0000${n}`;
}

function grayscale(n: number): string[] {
  if (n === 0) return [];
  if (n === 1) return ["#808080"];
  const out: string[] = Array.from({ length: n });
  for (let i = 0; i < n; i++) {
    const v = Math.round((i / (n - 1)) * 255);
    const hex = v.toString(16).padStart(2, "0");
    out[i] = `#${hex}${hex}${hex}`.toUpperCase();
  }
  return out;
}

function sampleLinear(cmap: LinearColormap, n: number): string[] {
  if (n === 0) return [];
  if (n === 1) return [srgbToHex(cmap.map(0.5))];
  const out: string[] = Array.from({ length: n });
  for (let i = 0; i < n; i++) {
    out[i] = srgbToHex(cmap.map(i / (n - 1)));
  }
  return out;
}

function sampleDiscreteCycling(cmap: DiscreteColormap, n: number): string[] {
  const src = cmap.colors;
  if (src.length === 0) return grayscale(n);
  const out: string[] = Array.from({ length: n });
  for (let i = 0; i < n; i++) out[i] = srgbToHex(src[i % src.length]);
  return out;
}

function buildTableau10Palette(n: number): string[] {
  if (n === 0) return [];
  const out: string[] = Array.from({ length: n });
  for (let i = 0; i < n; i++) out[i] = TABLEAU10_HEX[i % TABLEAU10_HEX.length];
  return out;
}

/**
 * Return `n` hex color strings for a named colormap. Matches the behavior of
 * the former backend `/data/categorical-palette` endpoint:
 *   - Discrete palettes cycle when `n > palette.length`.
 *   - Linear (continuous) palettes are sampled at `n` evenly-spaced t values.
 *   - Unknown names fall back to grayscale.
 *
 * Returned arrays are referentially stable per (name, n). Safe to pass to
 * React dep arrays and memoized children.
 */
export function getCategoricalPalette(name: string, n: number): string[] {
  const key = paletteCacheKey(name, n);
  const hit = paletteCache.get(key);
  if (hit) return hit;

  let out: string[];
  if (name === "tab10") {
    out = buildTableau10Palette(n);
  } else if (CATEGORICAL_CMAPS[name]) {
    out = sampleDiscreteCycling(CATEGORICAL_CMAPS[name], n);
  } else if (CONTINUOUS_CMAPS[name]) {
    out = sampleLinear(CONTINUOUS_CMAPS[name], n);
  } else {
    out = grayscale(n);
  }

  paletteCache.set(key, out);
  return out;
}

/**
 * Resolve a name to a ColorMap for direct GPU LUT building (used by
 * `ochre-lut.ts`). Lets continuous and categorical paths share the same
 * catalog without duplicating name→ColorMap lookup logic.
 */
export function resolveColormap(name: string): ColorMap | null {
  if (CONTINUOUS_CMAPS[name]) return CONTINUOUS_CMAPS[name];
  if (CATEGORICAL_CMAPS[name]) return CATEGORICAL_CMAPS[name];
  return null;
}
