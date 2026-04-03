import { tgpu } from "typegpu";
import * as d from "typegpu/data";
import type { ViewState } from "../../types";
import { createInteractionController } from "../hooks/useScatterInteraction";
import type { ScatterData, ScatterplotConfig, ScatterplotHandle } from "../types";
import { createBuffers, createUniforms, MAX_PALETTE_SIZE, uploadData } from "./buffers";
import { createCompositor } from "./compositor";
import { createCullingEngine } from "./culling";
import { acquireDevice, releaseDevice } from "./device-manager";
import { initGPU } from "./init";
import { createRenderPipeline } from "./pipeline";
import { createSelectionEngine } from "./selection";
import { createFragmentShader, createVertexShader } from "./shaders";

export async function createScatterplot(
  canvas: HTMLCanvasElement,
  overlay: HTMLCanvasElement,
  data: ScatterData,
  config?: ScatterplotConfig,
): Promise<ScatterplotHandle> {
  const t0 = performance.now();

  const deviceInfo = await acquireDevice();
  const gpu = initGPU(canvas, deviceInfo);
  const { root, device, context, format, preferredWorkgroupSize } = gpu;
  const tGpu = performance.now();
  console.log(`GPU init: ${(tGpu - t0).toFixed(1)}ms`);

  let pointRadius = config?.render?.pointRadius ?? 0.002;
  const selectionDimFactor = config?.render?.selectionDimFactor ?? 0.08;

  // Adaptive point sizing: computed once from point count (zoom-independent).
  // The vertex shader already has sqrt(zoom) for zoom-dependent sizing.
  const referenceCount = 50_000;
  const adaptiveScale = Math.max(0.3, Math.min(1.5, Math.sqrt(referenceCount / Math.max(1, data.numCells))));

  const uniforms = createUniforms(root, canvas.width / canvas.height, config?.render);
  uniforms.paramsUniform.write(d.vec4f(pointRadius, canvas.width / canvas.height, selectionDimFactor, adaptiveScale));
  const buffers = createBuffers(root, data.numCells, data.categoryNames.length);
  uploadData(root, device, buffers, data, config?.colorMapper, config?.palette);
  const tUpload = performance.now();
  console.log(`Buffer upload: ${(tUpload - tGpu).toFixed(1)}ms`);

  const culling = createCullingEngine(root, device, buffers, uniforms, data.numCells, preferredWorkgroupSize);

  const compositor = createCompositor(root, device, buffers, uniforms, data.numCells, preferredWorkgroupSize);

  // Default to transparent — let the CSS background-color of the container
  // show through. This makes the scatter canvas respond to dark/light theme
  // without requiring GPU re-initialization.
  const backgroundColor = config?.render?.backgroundColor ?? ([0, 0, 0, 0] as [number, number, number, number]);

  const mainVertex = createVertexShader(uniforms);
  const mainFragment = createFragmentShader();
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const { render } = createRenderPipeline(
    root,
    mainVertex,
    mainFragment,
    buffers,
    culling,
    format,
    backgroundColor,
    data.numCells,
  );

  const selection = createSelectionEngine(
    root,
    device,
    buffers,
    data.numCells,
    (count, indices) => {
      config?.callbacks?.onSelectionChange?.(count, indices);
    },
    preferredWorkgroupSize,
    compositor,
  );

  // ── GPU color-pack pipeline ────────────────────────────────────────────────
  // Instead of a O(n) CPU loop per palette change, pack colors on GPU:
  //   categoryBuffer[i] → paletteBuffer[cat] → colorBuffer[i]
  // CPU work per updateColors: O(palette_size) ≤ 64 entries (constant).
  const COLOR_PACK_BATCH = [0, 1, 2, 3] as const;
  const categoryReadonly = buffers.categoryBuffer.as("readonly");
  const colorMutable = buffers.colorBuffer.as("mutable");
  const paletteReadonly = buffers.paletteBuffer.as("readonly");

  const colorPackFn = tgpu
    .computeFn({
      workgroupSize: [preferredWorkgroupSize],
      in: { gid: d.builtin.globalInvocationId },
    })((input) => {
      "use gpu";
      const base = input.gid.x * COLOR_PACK_BATCH.length;
      const numCats = buffers.paletteLenUniform.$;
      for (const k of tgpu.unroll(COLOR_PACK_BATCH)) {
        const idx = base + k;
        if (idx < data.numCells) {
          const cat = categoryReadonly.$[idx] % numCats;
          colorMutable.$[idx] = paletteReadonly.$[cat];
        }
      }
    })
    .$uses({
      categoryReadonly,
      colorMutable,
      paletteReadonly,
      paletteLenUniform: buffers.paletteLenUniform,
    });

  const colorPackPipeline = root.createComputePipeline({ compute: colorPackFn });
  const colorPackWorkgroups = Math.ceil(data.numCells / (preferredWorkgroupSize * COLOR_PACK_BATCH.length));

  /** Pack a JS palette into the GPU palette buffer and dispatch the color-pack shader. */
  function gpuUpdateColors(
    palette: readonly (readonly [number, number, number, number?])[],
    categoryIndices?: Uint8Array,
  ) {
    const len = Math.min(palette.length, MAX_PALETTE_SIZE);
    const packed = new Uint32Array(MAX_PALETTE_SIZE);
    for (let i = 0; i < len; i++) {
      const c = palette[i];
      const r = Math.round(c[0] * 255);
      const g = Math.round(c[1] * 255);
      const b = Math.round(c[2] * 255);
      const a = c[3] !== undefined ? Math.round(c[3] * 255) : 255;
      packed[i] = (r | (g << 8) | (b << 16) | (a << 24)) >>> 0;
    }
    device.queue.writeBuffer(root.unwrap(buffers.paletteBuffer), 0, packed);
    buffers.paletteLenUniform.write(len);
    // If custom categoryIndices supplied (e.g. fresh from React), re-upload them first
    if (categoryIndices) {
      const catStaging = new Uint32Array(data.numCells);
      for (let i = 0; i < data.numCells; i++) catStaging[i] = categoryIndices[i]!;
      device.queue.writeBuffer(root.unwrap(buffers.categoryBuffer), 0, catStaging);
    }
    colorPackPipeline.dispatchWorkgroups(colorPackWorkgroups);
  }

  const tPipelines = performance.now();
  console.log(`Pipeline setup: ${(tPipelines - tUpload).toFixed(1)}ms`);

  let currentZoom = 1;
  let viewVersion = 0;

  const interaction = createInteractionController(
    canvas,
    overlay,
    uniforms,
    selection,
    () => {
      // Guard against 0-size canvas (hidden/collapsed Dockview panel)
      if (canvas.width === 0 || canvas.height === 0) return;
      culling.dispatchCulling(viewVersion);
      compositor.dispatchIfDirty();
      render(context, data.numCells, "clear");
    },
    {
      onViewChange: (state: ViewState) => {
        currentZoom = state.zoom;
        viewVersion++;
        config?.callbacks?.onViewChange?.(state);
      },
      onFps: (fps: number) => {
        config?.callbacks?.onFps?.(fps);
      },
      onPointClick: (worldX: number, worldY: number) => {
        const hitRadiusWorld = 20 / ((currentZoom * canvas.height) / 2);
        const maxDist2 = hitRadiusWorld * hitRadiusWorld;
        let bestIdx = -1;
        let bestDist2 = maxDist2;
        // Grid spatial index: query only cells that overlap the hit radius
        const r = Math.ceil((hitRadiusWorld / 2) * GRID) + 1;
        const cx = Math.floor(((worldX + 1) / 2) * GRID);
        const cy = Math.floor(((worldY + 1) / 2) * GRID);
        for (let gx = Math.max(0, cx - r); gx <= Math.min(GRID - 1, cx + r); gx++) {
          for (let gy = Math.max(0, cy - r); gy <= Math.min(GRID - 1, cy + r); gy++) {
            for (const i of gridCells[gx * GRID + gy]) {
              const px = data.positions[i * 2];
              const py = data.positions[i * 2 + 1];
              const dx = px - worldX;
              const dy = py - worldY;
              const d2 = dx * dx + dy * dy;
              if (d2 < bestDist2) {
                bestDist2 = d2;
                bestIdx = i;
              }
            }
          }
        }
        if (bestIdx >= 0) {
          selection.selectPoint(bestIdx);
          const px = data.positions[bestIdx * 2];
          const py = data.positions[bestIdx * 2 + 1];
          const catIdx = data.categoryIndices[bestIdx];
          config?.callbacks?.onPointClick?.(bestIdx, [px, py], catIdx, data.categoryNames[catIdx]);
        } else {
          config?.callbacks?.onBackgroundClick?.();
        }
      },
    },
    config?.interaction,
  );

  // ── Row index → point index lookup (built once, used by setExternalSelection) ──
  // Pre-building this Map avoids O(n) reconstruction on every selection sync event.
  const rowToPoint = new Map<number, number>(data.rowIndices.map((r, i) => [r, i]));

  // ── Grid spatial index for O(1) hit testing ───────────────────────────
  // World space is [-1,1]×[-1,1]. Divide into GRID×GRID cells; each cell
  // stores the indices of points that fall within it. onPointClick queries
  // only the 1–4 cells that overlap the hit radius instead of scanning all points.
  const GRID = 128;
  const gridCells: number[][] = Array.from({ length: GRID * GRID }, () => []);
  for (let i = 0; i < data.numCells; i++) {
    const gx = Math.min(GRID - 1, Math.max(0, Math.floor(((data.positions[i * 2] + 1) / 2) * GRID)));
    const gy = Math.min(GRID - 1, Math.max(0, Math.floor(((data.positions[i * 2 + 1] + 1) / 2) * GRID)));
    gridCells[gx * GRID + gy]?.push(i);
  }

  console.log(
    `Scatterplot ready: ${data.numCells.toLocaleString()} points in ${(performance.now() - t0).toFixed(1)}ms`,
  );

  // Debug: dump generated WGSL when ?debug-wgsl is in the URL
  if (typeof location !== "undefined" && new URLSearchParams(location.search).has("debug-wgsl")) {
    console.log("=== Vertex + Fragment WGSL ===");
    console.log(tgpu.resolve([mainVertex, mainFragment]));
    console.log("=== PIP Compute WGSL ===");
    console.log(tgpu.resolve([selection.pipComputeFn]));
    console.log("=== Compositor Compute WGSL ===");
    console.log(tgpu.resolve([compositor.compositorFn]));
    console.log("=== Culling Compute WGSL ===");
    console.log(tgpu.resolve([culling.cullComputeFn]));
  }

  return {
    resize(width: number, height: number) {
      const dpr = window.devicePixelRatio || 1;
      const gpuW = Math.floor(width * dpr);
      const gpuH = Math.floor(height * dpr);

      uniforms.paramsUniform.write(d.vec4f(pointRadius, gpuW / gpuH, selectionDimFactor, adaptiveScale));
      interaction.resize();
    },
    setPointRadius(r: number) {
      pointRadius = r;
      const { width, height } = canvas;
      const dpr = window.devicePixelRatio || 1;
      uniforms.paramsUniform.write(
        d.vec4f(pointRadius, (width * dpr) / Math.max(1, height * dpr), selectionDimFactor, adaptiveScale),
      );
      interaction.requestRender();
    },
    updateColors(palette: readonly (readonly [number, number, number, number?])[], categoryIndices?: Uint8Array) {
      // GPU compute shader packs category indices → palette → colorBuffer.
      // CPU work: O(palette_size) ≤ 64 entries (constant, not O(numPoints)).
      gpuUpdateColors(palette, categoryIndices);
      interaction.requestRender();
    },
    updateColorsDirect(rgba: Uint8Array) {
      // rgba is Uint8Array [R,G,B,A, R,G,B,A, ...] in [0,255].
      // On little-endian hardware a Uint32Array view of this memory gives
      // R|(G<<8)|(B<<16)|(A<<24) per element -> packed color format.
      // This is a zero-copy reinterpretation; no per-pixel loop needed.
      const colorData = new Uint32Array(rgba.buffer, rgba.byteOffset, data.numCells);
      device.queue.writeBuffer(root.unwrap(buffers.colorBuffer), 0, colorData);
      interaction.requestRender();
    },
    getViewState() {
      return interaction.getViewState();
    },
    worldToScreen(wx: number, wy: number, w: number, h: number) {
      const { panX, panY, zoom } = interaction.getViewState();
      const aspect = w / h;
      const clipX = ((wx + panX) * zoom) / aspect;
      const clipY = (wy + panY) * zoom;
      return {
        x: ((clipX + 1) / 2) * w,
        y: (1 - (clipY + 1) / 2) * h,
      };
    },
    setExternalSelection(rowIndices: number[]) {
      const pointIndices: number[] = [];
      for (const r of rowIndices) {
        const i = rowToPoint.get(r);
        if (i !== undefined) pointIndices.push(i);
      }
      selection.setSelectedPoints(pointIndices);
      interaction.requestRender();
    },
    clearExternalSelection() {
      selection.clearSelectionExternal();
      interaction.requestRender();
      config?.callbacks?.onExternalClear?.();
    },
    setCategoryIsolation(isolatedSet: Set<number>, categoryIndices: Uint8Array) {
      selection.setCategoryIsolation(isolatedSet, categoryIndices);
      interaction.requestRender();
    },
    clearCategoryIsolation() {
      selection.clearCategoryIsolation();
      interaction.requestRender();
    },
    /** Dim points whose row index is NOT in the provided set (continuous range filter). */
    setRowIsolation(rowIndices: number[]) {
      if (rowIndices.length === 0) {
        selection.setIsolationMask(null);
      } else {
        const mask = new Uint32Array(data.numCells);
        for (const r of rowIndices) {
          const i = rowToPoint.get(r);
          if (i !== undefined) mask[i] = 1;
        }
        selection.setIsolationMask(mask);
      }
      interaction.requestRender();
    },
    clearRowIsolation() {
      selection.setIsolationMask(null);
      interaction.requestRender();
    },
    setForcedSelectionMode(mode: "pan" | "marquee" | "lasso") {
      interaction.setForcedSelectionMode(mode);
    },
    setViewState(state: ViewState) {
      interaction.setViewState(state);
    },
    animateToViewState(state: ViewState, durationMs?: number) {
      interaction.animateToViewState(state, durationMs);
    },
    destroy() {
      interaction.destroy();
      selection.destroy();
      compositor.destroy();
      culling.destroy();
      root.destroy();
      releaseDevice();
    },
  };
}
