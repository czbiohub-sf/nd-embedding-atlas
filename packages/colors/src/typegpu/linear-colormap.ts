import { oklabToRgb, srgbToLinear } from "@typegpu/color";
import { tgpu, type TgpuFn } from "typegpu";
import * as d from "typegpu/data";
import * as std from "typegpu/std";
import { srgbToOkLab } from "../color/convert";
import { srgbToLinearRgb } from "../color/linear-rgb";
import { okLabToOkLch } from "../color/oklch";
import type { ColorStop, LinearColormap } from "../colormap/types";

/**
 * A colormap on the GPU: `t` in [0, 1] → linear-light RGB, alpha 1. Linear
 * because renderers blend there and encode for display once at the end.
 */
export type ColormapFn = TgpuFn<(t: d.F32) => d.Vec4f>;

type Vec3 = readonly [number, number, number];

const okLchToSrgb = tgpu
  .fn(
    [d.vec3f],
    d.vec3f,
  )((c) => {
    const hr = c.z * 0.017453292519943295;
    return oklabToRgb(d.vec3f(c.x, c.y * std.cos(hr), c.y * std.sin(hr)));
  })
  .$name("okLchToSrgb");

/**
 * One WGSL function per colormap: the stops (already in the interpolation
 * space) and their positions as constants, a scan for the segment holding
 * `t` (positions need not be even), a mix, and the space's way to linear RGB.
 */
function emit(
  name: string,
  positions: readonly number[],
  values: readonly Vec3[],
  toSrgb: string,
  uses: Record<string, unknown>,
): ColormapFn {
  const n = values.length;
  const wgsl = `(t: f32) -> vec4f {
  var pos = array<f32, ${n}>(${positions.map(num).join(", ")});
  var stops = array<vec3f, ${n}>(
${values.map((v) => `    vec3f(${v.map(num).join(", ")})`).join(",\n")}
  );
  let tc = clamp(t, 0.0, 1.0);
  var i = 0u;
  for (var k = 1u; k < ${n - 1}u; k++) {
    if (tc >= pos[k]) { i = k; }
  }
  let frac = clamp((tc - pos[i]) / max(pos[i + 1u] - pos[i], 1e-6), 0.0, 1.0);
  let mixed = mix(stops[i], stops[i + 1u], frac);
  return vec4f(${toSrgb}, 1.0);
}`;
  return tgpu.fn([d.f32], d.vec4f)(wgsl).$uses(uses).$name(name.replaceAll(/\W/g, "_"));
}

/** OkLch stops with hues unwrapped so adjacent deltas are ≤180°: `mix()` then takes the short arc. */
function unwrappedOkLch(stops: readonly ColorStop[]): Vec3[] {
  let last = Number.NaN;
  return stops.map(({ color }) => {
    const { l, c, h: raw } = okLabToOkLch(srgbToOkLab(color));
    let h = raw;
    if (!Number.isNaN(last)) {
      while (h - last > 180) h -= 360;
      while (h - last < -180) h += 360;
    }
    last = h;
    return [l, c, h];
  });
}

function build({ name, stops: given, interpolation }: LinearColormap): ColormapFn {
  const sorted = given.toSorted((a, b) => a.position - b.position);
  // One stop is a flat colormap; none is black.
  const stops: readonly ColorStop[] =
    sorted.length >= 2
      ? sorted
      : [0, 1].map((position) => ({ position, color: sorted[0]?.color ?? { r: 0, g: 0, b: 0, alpha: 1 } }));
  const positions = stops.map((s) => s.position);
  switch (interpolation) {
    case "srgb":
      return emit(
        name,
        positions,
        stops.map(({ color: c }): Vec3 => [c.r, c.g, c.b]),
        "srgbToLinear(mixed)",
        {
          srgbToLinear,
        },
      );
    case "linearRgb":
      return emit(
        name,
        positions,
        stops.map(({ color }): Vec3 => {
          const c = srgbToLinearRgb(color);
          return [c.r, c.g, c.b];
        }),
        "mixed",
        {},
      );
    case "oklab":
      return emit(
        name,
        positions,
        stops.map(({ color }): Vec3 => {
          const c = srgbToOkLab(color);
          return [c.l, c.a, c.b];
        }),
        "srgbToLinear(oklabToRgb(mixed))",
        { srgbToLinear, oklabToRgb },
      );
    case "oklch":
      return emit(name, positions, unwrappedOkLch(stops), "srgbToLinear(okLchToSrgb(mixed))", {
        srgbToLinear,
        okLchToSrgb,
      });
  }
}

const built = new WeakMap<LinearColormap, ColormapFn>();

/** `cmap` as a TypeGPU function, interpolating in the colormap's own space; one per colormap. */
export function toGpuColormap(cmap: LinearColormap): ColormapFn {
  let fn = built.get(cmap);
  if (!fn) {
    fn = build(cmap);
    built.set(cmap, fn);
  }
  return fn;
}

function num(x: number): string {
  const s = x.toString();
  return s.includes(".") || s.includes("e") ? s : `${s}.0`;
}
