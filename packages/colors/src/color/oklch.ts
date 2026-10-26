import type { OkLab, OkLch } from "./types";

export function okLch(l: number, c: number, h: number, alpha = 1): OkLch {
  return { l, c, h, alpha };
}

const RAD_TO_DEG = 180 / Math.PI;
const DEG_TO_RAD = Math.PI / 180;

export function okLabToOkLch(c: OkLab): OkLch {
  const chroma = Math.hypot(c.a, c.b);
  let h = Math.atan2(c.b, c.a) * RAD_TO_DEG;
  if (h < 0) h += 360;
  return { l: c.l, c: chroma, h, alpha: c.alpha };
}

export function okLchToOkLab(c: OkLch): OkLab {
  const hr = c.h * DEG_TO_RAD;
  return { l: c.l, a: c.c * Math.cos(hr), b: c.c * Math.sin(hr), alpha: c.alpha };
}
