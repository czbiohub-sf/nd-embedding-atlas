import { linearRgbToSrgb, srgbToLinearRgb } from "./linear-rgb";
import { linearRgbToOkLab, okLabToLinearRgb } from "./oklab";
import { okLabToOkLch, okLchToOkLab } from "./oklch";
import type { OkLab, OkLch, Srgb } from "./types";

export function srgbToOkLab(c: Srgb): OkLab {
  return linearRgbToOkLab(srgbToLinearRgb(c));
}

export function okLabToSrgb(c: OkLab): Srgb {
  return linearRgbToSrgb(okLabToLinearRgb(c));
}

export function srgbToOkLch(c: Srgb): OkLch {
  return okLabToOkLch(srgbToOkLab(c));
}

export function okLchToSrgb(c: OkLch): Srgb {
  return okLabToSrgb(okLchToOkLab(c));
}
