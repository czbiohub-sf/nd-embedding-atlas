import { tgpu } from "typegpu";
import * as d from "typegpu/data";
import { QUAD_VERTS } from "../../gpu/constants";
import type { RenderConfig, TgpuRoot } from "../../gpu/types";

// Maximum number of palette entries supported by the GPU color-pack shader.
export const MAX_PALETTE_SIZE = 64;

const DEFAULTS = {
  pointRadius: 0.002,
  selectionDimFactor: 0.08,
  /**
   * Default per-point alpha multiplier: pinned to 1.0 for solid markers.
   * Lower values are useful when overdraw should fade in via additive
   * blending; users opt in via the dev-tools slider when needed.
   */
  pointOpacity: 1.0,
} as const;

export function createUniforms(root: TgpuRoot, aspectRatio: number, renderConfig?: RenderConfig) {
  const pointRadius = renderConfig?.pointRadius ?? DEFAULTS.pointRadius;
  const paramsUniform = root.createUniform(
    d.vec4f,
    d.vec4f(pointRadius, aspectRatio, renderConfig?.selectionDimFactor ?? DEFAULTS.selectionDimFactor, 1),
  );
  const viewUniform = root.createUniform(d.vec4f, d.vec4f(0, 0, 1, aspectRatio));
  const selectionModeUniform = root.createUniform(d.f32, 0);
  const predicateFilterActiveUniform = root.createUniform(d.u32, 0);
  // 1 = tier-0 points (failed isolation) render at zero radius; 0 = dim per tierAlpha.
  // Raised by the continuous range slider so out-of-range points are hidden, not dimmed.
  const filterHideUniform = root.createUniform(d.u32, 0);
  // Per-point alpha multiplier (Path A pointOpacity). Internally still named
  // `sharpnessUniform` because the picking-shaders.ts WGSL strings reference
  // it by that name at @binding(4); renaming would force a binding-layout
  // refactor in the picking pipeline. The fragment shader uses it as an
  // alpha multiplier, picking uses it as a falloff exponent: both work in
  // the [0.05, 1.0] opacity range without tuning.
  const sharpnessUniform = root.createUniform(d.f32, renderConfig?.pointOpacity ?? DEFAULTS.pointOpacity);
  // Minimum NDC quad half-extent: keeps point markers above ~1.5 device
  // pixels at any zoom so the fragment-shader fwidth AA stays valid.
  // Initialised to 0; orchestrator writes a real value on first resize.
  const pixelFloorUniform = root.createUniform(d.f32, 0);
  return {
    paramsUniform,
    viewUniform,
    selectionModeUniform,
    predicateFilterActiveUniform,
    filterHideUniform,
    sharpnessUniform,
    pixelFloorUniform,
  };
}

export type ScatterUniforms = ReturnType<typeof createUniforms>;

export function createBuffers(root: TgpuRoot, numPoints: number) {
  const quadBuffer = root
    .createBuffer(
      d.arrayOf(d.vec2f, 6),
      QUAD_VERTS.map(([x, y]) => d.vec2f(x, y)),
    )
    .$usage("vertex");

  const posBuffer = root.createBuffer(d.arrayOf(d.vec2f, numPoints)).$usage("vertex", "storage");

  // Packed RGBA as u32 (4 bytes/point vs 16 bytes for vec4f): 4× bandwidth reduction.
  // Byte layout (little-endian): [R, G, B, A] packed as R | (G<<8) | (B<<16) | (A<<24).
  // The vertex shader unpacks via the unpackColor WGSL fn in shaders.ts.
  // "storage" allows the GPU color-pack compute shader to write packed RGBA directly
  const colorBuffer = root.createBuffer(d.arrayOf(d.u32, numPoints)).$usage("vertex", "storage");

  const selectedBuffer = root.createBuffer(d.arrayOf(d.u32, numPoints)).$usage("vertex", "storage");
  // Filter-scope predicate as a bit layer: bit `i & 31` of word `i >> 5` is point i.
  const predicateBits = root.createBuffer(d.arrayOf(d.u32, Math.ceil(numPoints / 32))).$usage("storage");

  // Category indices (u32 per point): used by density engine and GPU color-pack shader
  const categoryBuffer = root.createBuffer(d.arrayOf(d.u32, numPoints)).$usage("storage");

  // Palette buffer: MAX_PALETTE_SIZE packed u32 RGBA entries, written by updateColors.
  // GPU color-pack shader reads this + categoryBuffer to write colorBuffer on GPU.
  const paletteBuffer = root.createBuffer(d.arrayOf(d.u32, MAX_PALETTE_SIZE)).$usage("storage");
  const paletteLenUniform = root.createUniform(d.u32, 0);

  const colorLayout = tgpu.vertexLayout((n: number) => d.arrayOf(d.u32, n), "instance");

  const selectedLayout = tgpu.vertexLayout((n: number) => d.arrayOf(d.u32, n), "instance");

  const quadLayout = tgpu.vertexLayout((n: number) => d.arrayOf(d.vec2f, n), "vertex");

  const posLayout = tgpu.vertexLayout((n: number) => d.arrayOf(d.vec2f, n), "instance");

  return {
    quadBuffer,
    posBuffer,
    colorBuffer,
    selectedBuffer,
    predicateBits,
    categoryBuffer,
    paletteBuffer,
    paletteLenUniform,
    colorLayout,
    selectedLayout,
    quadLayout,
    posLayout,
  };
}

export type ScatterBuffers = ReturnType<typeof createBuffers>;
