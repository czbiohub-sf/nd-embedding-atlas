import { converter, formatHex, modeOklch, modeRgb, parse, useMode } from "culori/fn";

// Register oklch and rgb modes so formatHex can convert oklch → sRGB → hex
useMode(modeOklch);
useMode(modeRgb);

const toOklch = converter("oklch");

export interface OklchColor {
  l: number;
  c: number;
  h: number;
}

export function hexToOklch(hex: string): OklchColor | null {
  const parsed = parse(hex);
  if (!parsed) return null;
  const ok = toOklch(parsed);
  return { l: ok.l, c: ok.c ?? 0, h: ok.h ?? 0 };
}

export function oklchToHex(color: OklchColor): string {
  return formatHex({ mode: "oklch", l: color.l, c: color.c, h: color.h });
}
