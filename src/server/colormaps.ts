/**
 * Colormap catalog + palette generator.
 *
 * Uses d3-scale-chromatic for both categorical schemes (fixed colour lists)
 * and continuous interpolators (functions of t ∈ [0, 1]). For categorical
 * schemes with fewer entries than requested we cycle; for continuous palettes
 * we sample uniformly across [0, 1].
 */

import * as d3 from "d3-scale-chromatic";

// ─── Catalog ────────────────────────────────────────────────────────────────

/** Map of categorical colormap name → hex scheme (strings with '#'). */
const CATEGORICAL_SCHEMES: Record<string, readonly string[]> = {
  tab10: d3.schemeTableau10,
  Category10: d3.schemeCategory10,
  Set1: d3.schemeSet1,
  Set2: d3.schemeSet2,
  Set3: d3.schemeSet3,
  Paired: d3.schemePaired,
  Dark2: d3.schemeDark2,
  Accent: d3.schemeAccent,
  Pastel1: d3.schemePastel1,
  Pastel2: d3.schemePastel2,
};

/** Map of continuous colormap name → sampler (t ∈ [0, 1] → hex with '#'). */
const CONTINUOUS_SAMPLERS: Record<string, (t: number) => string> = {
  viridis: d3.interpolateViridis,
  inferno: d3.interpolateInferno,
  magma: d3.interpolateMagma,
  plasma: d3.interpolatePlasma,
  cividis: d3.interpolateCividis,
  turbo: d3.interpolateTurbo,
  cool: d3.interpolateCool,
  warm: d3.interpolateWarm,
  greys: d3.interpolateGreys,
  blues: d3.interpolateBlues,
  greens: d3.interpolateGreens,
  oranges: d3.interpolateOranges,
  reds: d3.interpolateReds,
  RdBu: d3.interpolateRdBu,
  RdYlBu: d3.interpolateRdYlBu,
  Spectral: d3.interpolateSpectral,
};

// ─── Public API ─────────────────────────────────────────────────────────────

export function categoricalNames(): string[] {
  return Object.keys(CATEGORICAL_SCHEMES);
}

export function continuousNames(): string[] {
  return Object.keys(CONTINUOUS_SAMPLERS);
}

/**
 * Sample a continuous colormap at `t ∈ [0, 1]`. Returns [r, g, b] byte
 * triple, or null if the colormap isn't in the catalog.
 */
export function sampleContinuous(name: string, t: number): [number, number, number] | null {
  const interpolator = CONTINUOUS_SAMPLERS[name];
  if (!interpolator) return null;
  const clamped = Math.max(0, Math.min(1, t));
  return parseRgbBytes(interpolator(clamped));
}

/** Parse a d3-returned color ("#rrggbb", "#rgb", or "rgb(r, g, b)") into byte triple. */
function parseRgbBytes(value: string): [number, number, number] {
  if (value.startsWith("#")) {
    const hex = value.length === 4 ? `#${value[1]}${value[1]}${value[2]}${value[2]}${value[3]}${value[3]}` : value;
    const r = Number.parseInt(hex.slice(1, 3), 16);
    const g = Number.parseInt(hex.slice(3, 5), 16);
    const b = Number.parseInt(hex.slice(5, 7), 16);
    return [r, g, b];
  }
  const m = value.match(/rgb\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i);
  if (!m) return [0, 0, 0];
  return [
    Math.max(0, Math.min(255, Math.round(Number.parseFloat(m[1])))),
    Math.max(0, Math.min(255, Math.round(Number.parseFloat(m[2])))),
    Math.max(0, Math.min(255, Math.round(Number.parseFloat(m[3])))),
  ];
}

/**
 * Get `n` hex colors for a colormap. Tries the categorical catalog first
 * (cycling if `n` exceeds the scheme size), then the continuous catalog
 * (uniform samples), then falls back to an HSL rainbow.
 */
export function getPalette(name: string, n: number): string[] {
  const count = Math.max(0, Math.min(4096, Math.floor(n)));

  const scheme = CATEGORICAL_SCHEMES[name];
  if (scheme && scheme.length > 0) {
    const out: string[] = Array.from({ length: count }, (_, i) => normaliseHex(scheme[i % scheme.length]));
    return out;
  }

  const interpolator = CONTINUOUS_SAMPLERS[name];
  if (interpolator) {
    if (count === 0) return [];
    if (count === 1) return [rgbToHex(interpolator(0.5))];
    const out: string[] = Array.from({ length: count }, (_, i) => rgbToHex(interpolator(i / (count - 1))));
    return out;
  }

  // Fallback: rotating HSL rainbow. Keeps the frontend rendering something
  // sensible for unknown colormap names.
  return Array.from({ length: count }, (_, i) => {
    const hue = count > 0 ? Math.round((i * 360) / count) : 0;
    return hslToHex(hue, 70, 50);
  });
}

// ─── Conversions ────────────────────────────────────────────────────────────

function normaliseHex(value: string): string {
  // d3 may return either #rgb, #rrggbb, or rgb(...). Normalise to #RRGGBB.
  if (value.startsWith("#")) {
    if (value.length === 7) return value.toUpperCase();
    if (value.length === 4) {
      // #rgb → #rrggbb
      const expanded = value
        .slice(1)
        .split("")
        .map((c) => c + c)
        .join("");
      return `#${expanded}`.toUpperCase();
    }
  }
  if (value.startsWith("rgb")) {
    return rgbToHex(value);
  }
  return value.toUpperCase();
}

function rgbToHex(value: string): string {
  if (value.startsWith("#")) return normaliseHex(value);
  const match = value.match(/rgb\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i);
  if (!match) return "#000000";
  const r = Math.round(Number.parseFloat(match[1]));
  const g = Math.round(Number.parseFloat(match[2]));
  const b = Math.round(Number.parseFloat(match[3]));
  const hex = [r, g, b].map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, "0")).join("");
  return `#${hex}`.toUpperCase();
}

function hslToHex(h: number, s: number, l: number): string {
  const sFrac = s / 100;
  const lFrac = l / 100;
  const k = (n: number): number => (n + h / 30) % 12;
  const a = sFrac * Math.min(lFrac, 1 - lFrac);
  const f = (n: number): number => lFrac - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const hex = [f(0), f(8), f(4)]
    .map((v) =>
      Math.round(v * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("");
  return `#${hex}`.toUpperCase();
}
