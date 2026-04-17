import type { LinearRgb, Srgb } from "./types";

export function linearRgb(r: number, g: number, b: number, alpha = 1): LinearRgb {
  return { r, g, b, alpha };
}

export function srgbChannelToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function linearChannelToSrgb(c: number): number {
  return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

export function srgbToLinearRgb(c: Srgb): LinearRgb {
  return {
    r: srgbChannelToLinear(c.r),
    g: srgbChannelToLinear(c.g),
    b: srgbChannelToLinear(c.b),
    alpha: c.alpha,
  };
}

export function linearRgbToSrgb(c: LinearRgb): Srgb {
  return {
    r: linearChannelToSrgb(c.r),
    g: linearChannelToSrgb(c.g),
    b: linearChannelToSrgb(c.b),
    alpha: c.alpha,
  };
}
