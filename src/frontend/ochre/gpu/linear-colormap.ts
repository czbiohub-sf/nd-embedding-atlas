import { tgpu, type TgpuFn } from "typegpu";
import * as d from "typegpu/data";
import * as std from "typegpu/std";
import { srgbToLinearRgb as srgbToLinearRgbCpu } from "../color/linear-rgb";
import { srgbToOkLab as srgbToOkLabCpu } from "../color/convert";
import { okLabToOkLch as okLabToOkLchCpu } from "../color/oklch";
import type { ColorStop } from "../colormap/types";
import { linearRgbToSrgb, okLabToSrgb } from "./color";

export type ColormapFn = TgpuFn<(t: d.F32) => d.Vec4f>;

export interface LinearColormapGpuOptions {
  readonly name: string;
  readonly stops: readonly ColorStop[];
}

// Shared WGSL emitter: precomputed stops + mix + space-specific final conversion.
function emitColormap(
  name: string,
  arrayEntries: string[],
  finalExpr: string,
  uses: Record<string, unknown>,
): ColormapFn {
  const n = arrayEntries.length;
  const wgsl = `(t: f32) -> vec4f {
  var stops = array<vec3f, ${n}>(
${arrayEntries.map((e) => `    ${e}`).join(",\n")}
  );
  let tc = clamp(t, 0.0, 1.0);
  let scaled = tc * ${num(n - 1)};
  let idx = min(u32(floor(scaled)), ${n - 2}u);
  let frac = scaled - f32(idx);
  let mixed = mix(stops[idx], stops[idx + 1u], frac);
  let rgb = ${finalExpr};
  return vec4f(rgb, 1.0);
}`;
  return tgpu.fn([d.f32], d.vec4f)(wgsl).$uses(uses).$name(name);
}

function sortStops(stops: readonly ColorStop[]): ColorStop[] {
  if (stops.length < 2) throw new Error(`need >= 2 stops, got ${stops.length}`);
  return [...stops].toSorted((a, b) => a.position - b.position);
}

function stopsVec3f(values: readonly { x: number; y: number; z: number }[]): string[] {
  return values.map((v) => `vec3f(${num(v.x)}, ${num(v.y)}, ${num(v.z)})`);
}

/** GPU colormap that interpolates stops directly in sRGB space. */
export function toGpuSrgb(opts: LinearColormapGpuOptions): ColormapFn {
  const sorted = sortStops(opts.stops);
  const entries = stopsVec3f(sorted.map((s) => ({ x: s.color.r, y: s.color.g, z: s.color.b })));
  return emitColormap(opts.name, entries, "mixed", {});
}

/** GPU colormap that interpolates in linear RGB, then gamma-encodes to sRGB. */
export function toGpuLinearRgb(opts: LinearColormapGpuOptions): ColormapFn {
  const sorted = sortStops(opts.stops);
  const linear = sorted.map((s) => srgbToLinearRgbCpu(s.color));
  const entries = stopsVec3f(linear.map((c) => ({ x: c.r, y: c.g, z: c.b })));
  return emitColormap(opts.name, entries, "linearRgbToSrgb(mixed)", { linearRgbToSrgb });
}

/** GPU colormap that interpolates in OkLab (perceptually uniform). Default. */
export function toGpuOkLab(opts: LinearColormapGpuOptions): ColormapFn {
  const sorted = sortStops(opts.stops);
  const labs = sorted.map((s) => srgbToOkLabCpu(s.color));
  const entries = stopsVec3f(labs.map((c) => ({ x: c.l, y: c.a, z: c.b })));
  return emitColormap(opts.name, entries, "okLabToSrgb(mixed)", { okLabToSrgb });
}

// OkLch conversion used only by the OkLch colormap path. Kept local so that
// callers of other interpolation variants don't pull it in.
const okLchToSrgb = tgpu
  .fn(
    [d.vec3f],
    d.vec3f,
  )((c) => {
    const hr = c.z * 0.017453292519943295;
    return okLabToSrgb(d.vec3f(c.x, c.y * std.cos(hr), c.y * std.sin(hr)));
  })
  .$name("okLchToSrgb");

/**
 * GPU colormap that interpolates in OkLch (shortest-arc hue).
 * Hues are unwrapped at build time so adjacent stop deltas are ≤180°,
 * which lets the GPU's `mix()` produce the shortest-arc path without
 * a custom WGSL lerp.
 */
export function toGpuOkLch(opts: LinearColormapGpuOptions): ColormapFn {
  const sorted = sortStops(opts.stops);
  const lchs = sorted.map((s) => okLabToOkLchCpu(srgbToOkLabCpu(s.color)));

  // Unwrap hues: walk stops and shift each h so |h - prev| ≤ 180.
  const unwrapped: { l: number; c: number; h: number }[] = [];
  let lastH = lchs[0].h;
  for (const lch of lchs) {
    let h = lch.h;
    while (h - lastH > 180) h -= 360;
    while (h - lastH < -180) h += 360;
    unwrapped.push({ l: lch.l, c: lch.c, h });
    lastH = h;
  }

  const entries = stopsVec3f(unwrapped.map((c) => ({ x: c.l, y: c.c, z: c.h })));
  return emitColormap(opts.name, entries, "okLchToSrgb(mixed)", { okLchToSrgb });
}

/** @deprecated Alias for `toGpuOkLab`; prefer the explicit name. */
export const linearColormapGpu = toGpuOkLab;

function num(x: number): string {
  const s = x.toString();
  return s.includes(".") || s.includes("e") ? s : `${s}.0`;
}
