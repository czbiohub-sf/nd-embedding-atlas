import { okLchToSrgb, srgbToOkLch } from "@/ochre/color/convert";
import { srgbFromHex, srgbToHex } from "@/ochre/color/srgb";
import { ParseColorError } from "@/ochre/color/types";

export interface OklchColor {
  l: number;
  c: number;
  h: number;
}

/** Parse a hex string to OkLch. Returns null on invalid input (parity with the culori-backed API). */
export function hexToOklch(hex: string): OklchColor | null {
  try {
    const { l, c, h } = srgbToOkLch(srgbFromHex(hex));
    return { l, c, h };
  } catch (err) {
    if (err instanceof ParseColorError) return null;
    throw err;
  }
}

/** Convert OkLch → #rrggbb. Clamps out-of-gamut colors to sRGB. */
export function oklchToHex(color: OklchColor): string {
  return srgbToHex(okLchToSrgb({ l: color.l, c: color.c, h: color.h, alpha: 1 }));
}
