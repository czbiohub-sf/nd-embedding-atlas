import tgpu from "typegpu";
import * as d from "typegpu/data";
import { QUAD_VERTS, PALETTE } from "../constants";
import type { ScatterData, TgpuRoot, ColorMapper, RenderConfig } from "../types";

const DEFAULTS = {
  pointRadius: 0.003,
  selectionDimFactor: 0.08,
} as const;

export function createUniforms(
  root: TgpuRoot,
  aspectRatio: number,
  renderConfig?: RenderConfig,
) {
  const pointRadius = renderConfig?.pointRadius ?? DEFAULTS.pointRadius;
  const paramsUniform = root.createUniform(
    d.vec4f,
    d.vec4f(pointRadius, aspectRatio, renderConfig?.selectionDimFactor ?? DEFAULTS.selectionDimFactor, 1),
  );
  const viewUniform = root.createUniform(d.vec4f, d.vec4f(0, 0, 1, aspectRatio));
  const selectionModeUniform = root.createUniform(d.f32, 0);
  return { paramsUniform, viewUniform, selectionModeUniform };
}

export type ScatterUniforms = ReturnType<typeof createUniforms>;

export function createBuffers(root: TgpuRoot, numPoints: number, _numCategories: number) {
  const quadBuffer = root
    .createBuffer(
      d.arrayOf(d.vec2f, 6),
      QUAD_VERTS.map(([x, y]) => d.vec2f(x, y)),
    )
    .$usage("vertex");

  const posBuffer = root
    .createBuffer(d.arrayOf(d.vec2f, numPoints))
    .$usage("vertex", "storage");

  // Packed RGBA as u32 (4 bytes/point vs 16 bytes for vec4f) — 4× bandwidth reduction.
  // Byte layout (little-endian): [R, G, B, A] packed as R | (G<<8) | (B<<16) | (A<<24).
  // The vertex shader unpacks via the unpackColor WGSL fn in shaders.ts.
  const colorBuffer = root
    .createBuffer(d.arrayOf(d.u32, numPoints))
    .$usage("vertex");

  const selectedBuffer = root
    .createBuffer(d.arrayOf(d.u32, numPoints))
    .$usage("vertex", "storage");

  // Category indices (u32 per point) — used by density engine
  const categoryBuffer = root
    .createBuffer(d.arrayOf(d.u32, numPoints))
    .$usage("storage");

  const colorLayout = tgpu.vertexLayout(
    (n: number) => d.arrayOf(d.u32, n),
    "instance",
  );

  const selectedLayout = tgpu.vertexLayout(
    (n: number) => d.arrayOf(d.u32, n),
    "instance",
  );

  const quadLayout = tgpu.vertexLayout(
    (n: number) => d.arrayOf(d.vec2f, n),
    "vertex",
  );

  const posLayout = tgpu.vertexLayout(
    (n: number) => d.arrayOf(d.vec2f, n),
    "instance",
  );

  return {
    quadBuffer,
    posBuffer,
    colorBuffer,
    selectedBuffer,
    categoryBuffer,
    colorLayout,
    selectedLayout,
    quadLayout,
    posLayout,
  };
}

export type ScatterBuffers = ReturnType<typeof createBuffers>;

/**
 * Upload scatter data to GPU buffers.
 *
 * Flow:
 *   1. Direct writeBuffer for positions (zero-copy Float32Array)
 *   2. Upload category indices (for density engine)
 *   3. Pack category → RGBA colors on CPU and upload as vec4f
 *   4. clearBuffer for selection
 */
export function uploadData(
  root: TgpuRoot,
  device: GPUDevice,
  buffers: ScatterBuffers,
  data: ScatterData,
  colorMapper?: ColorMapper,
  palette?: readonly (readonly [number, number, number])[],
) {
  const t0 = performance.now();
  const numPoints = data.numCells;

  // 1. Positions: direct upload (already Float32Array, layout matches vec2f)
  const rawPosBuffer = root.unwrap(buffers.posBuffer);
  device.queue.writeBuffer(rawPosBuffer, 0, data.positions);
  const tPos = performance.now();

  // 2. Upload category indices as u32 buffer (used by density engine)
  const catStaging = new Uint32Array(numPoints);
  for (let i = 0; i < numPoints; i++) {
    catStaging[i] = data.categoryIndices[i]!;
  }
  const rawCatBuffer = root.unwrap(buffers.categoryBuffer);
  device.queue.writeBuffer(rawCatBuffer, 0, catStaging);

  // 3. Pack colors on CPU: category index → palette → u32 packed RGBA (4 bytes/point).
  // Palette values are 0–255; pack as R|(G<<8)|(B<<16)|(255<<24) for little-endian unorm8x4.
  const colors = palette ?? PALETTE;
  const numCats = colors.length;
  const totalCats = data.categoryNames.length;
  const colorData = new Uint32Array(numPoints);
  for (let i = 0; i < numPoints; i++) {
    const cat = data.categoryIndices[i]! % numCats;
    let r: number, g: number, b: number;
    if (colorMapper) {
      [r, g, b] = colorMapper(cat, i, totalCats);
    } else {
      const c = colors[cat]!;
      r = c[0]; g = c[1]; b = c[2];
    }
    colorData[i] = (r | (g << 8) | (b << 16) | (255 << 24)) >>> 0;
  }
  const rawColorBuffer = root.unwrap(buffers.colorBuffer);
  device.queue.writeBuffer(rawColorBuffer, 0, colorData);
  const tColor = performance.now();

  // 4. Clear selection buffer
  const rawSelectedBuffer = root.unwrap(buffers.selectedBuffer);
  const encoder = device.createCommandEncoder();
  encoder.clearBuffer(rawSelectedBuffer);
  device.queue.submit([encoder.finish()]);

  console.log(
    `Data upload: ${numPoints.toLocaleString()} points in ${(performance.now() - t0).toFixed(1)}ms` +
    ` (pos: ${(tPos - t0).toFixed(1)}ms, color: ${(tColor - tPos).toFixed(1)}ms)`,
  );
}

/**
 * Build a Float32Array of category colors as vec4f (RGBA 0–1) × 32 slots.
 * Used by the per-category density contour renderer.
 */
export function buildCategoryColors(
  numCategories: number,
  colorMapper?: ColorMapper,
  palette?: readonly (readonly [number, number, number])[],
): Float32Array {
  const maxCats = 32;
  const data = new Float32Array(maxCats * 4);
  const colors = palette ?? PALETTE;
  const n = Math.min(numCategories, maxCats);

  for (let i = 0; i < n; i++) {
    let r: number, g: number, b: number;
    if (colorMapper) {
      [r, g, b] = colorMapper(i, 0, numCategories);
    } else {
      const c = colors[i % colors.length]!;
      r = c[0]; g = c[1]; b = c[2];
    }
    data[i * 4] = r / 255;
    data[i * 4 + 1] = g / 255;
    data[i * 4 + 2] = b / 255;
    data[i * 4 + 3] = 1.0;
  }
  return data;
}
