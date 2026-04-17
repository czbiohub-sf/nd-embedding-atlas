import { ParseColorError, type Srgb } from "./types";

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

export function srgb(r: number, g: number, b: number, alpha = 1): Srgb {
  return { r, g, b, alpha };
}

export function srgbFromU8(r: number, g: number, b: number, a = 255): Srgb {
  return { r: r / 255, g: g / 255, b: b / 255, alpha: a / 255 };
}

export function srgbToU8(c: Srgb): [number, number, number, number] {
  return [
    Math.round(clamp01(c.r) * 255),
    Math.round(clamp01(c.g) * 255),
    Math.round(clamp01(c.b) * 255),
    Math.round(clamp01(c.alpha) * 255),
  ];
}

export function srgbFromHex(hex: string): Srgb {
  const raw = hex.startsWith("#") ? hex.slice(1) : hex;
  const parse = (s: string) => {
    const n = Number.parseInt(s, 16);
    if (Number.isNaN(n)) throw new ParseColorError(`invalid hex color: ${hex}`);
    return n;
  };

  if (raw.length === 3) {
    const r = parse(raw[0]);
    const g = parse(raw[1]);
    const b = parse(raw[2]);
    return srgbFromU8(r * 17, g * 17, b * 17);
  }
  if (raw.length === 6) {
    return srgbFromU8(parse(raw.slice(0, 2)), parse(raw.slice(2, 4)), parse(raw.slice(4, 6)));
  }
  if (raw.length === 8) {
    return srgbFromU8(parse(raw.slice(0, 2)), parse(raw.slice(2, 4)), parse(raw.slice(4, 6)), parse(raw.slice(6, 8)));
  }
  throw new ParseColorError(`expected 3, 6, or 8 hex digits, got ${raw.length}`);
}

const hex = (n: number) => n.toString(16).padStart(2, "0");

export function srgbToHex(c: Srgb): string {
  const [r, g, b, a] = srgbToU8(c);
  return a === 255 ? `#${hex(r)}${hex(g)}${hex(b)}` : `#${hex(r)}${hex(g)}${hex(b)}${hex(a)}`;
}

export function srgbToCss(c: Srgb): string {
  const [r, g, b] = srgbToU8(c);
  return Math.abs(c.alpha - 1) < Number.EPSILON
    ? `rgb(${r}, ${g}, ${b})`
    : `rgba(${r}, ${g}, ${b}, ${c.alpha.toFixed(3)})`;
}

export function srgbToArray(c: Srgb): [number, number, number, number] {
  return [c.r, c.g, c.b, c.alpha];
}

export function srgbFromArray(arr: readonly [number, number, number, number]): Srgb {
  return { r: arr[0], g: arr[1], b: arr[2], alpha: arr[3] };
}
