import { tgpu } from "typegpu";
import * as d from "typegpu/data";
import * as std from "typegpu/std";
import type { RowIndex } from "@ndea/sdk";
import { type GpuPointIndex, gpuPointIndex, type ViewState } from "../../contracts";
import { createInteractionController } from "../../gpu/hooks/useScatterInteraction";
import type { ScatterData, ScatterplotConfig, ScatterplotHandle } from "../../gpu/types";
import { createBuffers, createUniforms, MAX_PALETTE_SIZE, uploadData } from "./buffers";
import { createCompositor } from "./compositor";
import { createCullingEngine } from "./culling";
import type { DeviceInfo } from "@ndea/sdk";
import { createHdrPipeline } from "./hdr";
import { initGPU } from "./init";
import { createPickingSystem } from "./picking";
import { type BlendMode, createBlendableRenderPipelines } from "./pipeline";
import { createSelectionEngine } from "./selection";
import { createFragmentShader, createVertexShader } from "./shaders";

export interface CreateScatterplotOpts {
  /** Aborted on host teardown: threaded into device acquire so a fast
   *  add/delete cannot strand a device mid-init (PLUGIN-ARCHITECTURE §7.2). */
  signal?: AbortSignal;
  /**
   * Pre-acquired device lease from `host.acquireDeviceLease()` (PLUGIN-ARCHITECTURE
   * §7.1). When supplied, this instance uses the lease's already-leased device and
   * does NOT acquire/release the shared refcount itself: the lease owner
   * (`host.dispose`) controls the device lifetime, so the device survives data
   * swaps (positionKey re-init) instead of churning. Typed structurally to avoid a
   * `scatter-gpu → core` import cycle; the broker's `DeviceLease` is compatible.
   */
  lease: { readonly info: DeviceInfo };
}

export async function createScatterplot(
  canvas: HTMLCanvasElement,
  overlay: HTMLCanvasElement,
  data: ScatterData,
  config?: ScatterplotConfig,
  opts?: CreateScatterplotOpts,
): Promise<ScatterplotHandle> {
  const t0 = performance.now();
  if (!opts) throw new Error("createScatterplot requires a GPU device lease");

  // Leased device (host-managed) is authoritative: skip the self-acquire so the
  // broker refcount is incremented exactly once per instance, by the lease owner.
  const deviceInfo = opts.lease.info;
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

  // Minimum on-screen point half-size, in device pixels. Below this the
  // SDF disk's fwidth-based AA degrades to "looks like a square."
  const MIN_POINT_PIXEL_HALF = 1.5;

  const uniforms = createUniforms(root, canvas.width / canvas.height, config?.render);
  uniforms.paramsUniform.write(d.vec4f(pointRadius, canvas.width / canvas.height, selectionDimFactor, adaptiveScale));
  // Initial pixel floor: recomputed on every resize.
  {
    const dpr = window.devicePixelRatio || 1;
    const gpuH = Math.max(1, Math.floor(canvas.height * dpr));
    uniforms.pixelFloorUniform.write((2 * MIN_POINT_PIXEL_HALF) / gpuH);
  }
  const buffers = createBuffers(root, data.numCells, data.categoryNames.length);
  uploadData(root, device, buffers, data, config?.colorMapper, config?.palette);
  const tUpload = performance.now();
  console.log(`Buffer upload: ${(tUpload - tGpu).toFixed(1)}ms`);

  const culling = createCullingEngine(root, device, buffers, uniforms, data.numCells, preferredWorkgroupSize);

  const compositor = createCompositor(root, device, buffers, uniforms, data.numCells, preferredWorkgroupSize);

  // GPU pick buffer: replaces the CPU spatial-grid hit test when the user
  // opts in via `localStorage.ndea.useGpuPicking`. Renders to an offscreen
  // rgba32f target with brightness-as-depth so overlapping points pick by
  // visual frontmost (brightest), not geometric nearest. Same vertex
  // attributes as the main render: stays in lockstep automatically.
  const picking = createPickingSystem(root, canvas, buffers, uniforms, culling, data.numCells);
  picking.updateBoundingBox(data.positions);

  // Default to transparent: let the CSS background-color of the container
  // show through. This makes the scatter canvas respond to dark/light theme
  // without requiring GPU re-initialization.
  const backgroundColor = config?.render?.backgroundColor ?? ([0, 0, 0, 0] as [number, number, number, number]);

  // HDR pipeline: scatter draws into an rgba16float target instead of the
  // canvas swap chain. The HDR pass then tone-maps to the canvas. Lets dense
  // overlapping points accumulate above 1.0 before the curve clips.
  const hdr = createHdrPipeline(device, format, canvas.width || 1, canvas.height || 1);

  const mainVertex = createVertexShader(uniforms);
  const mainFragment = createFragmentShader();
  // Build all three blend-mode variants up front; switching at runtime is a
  // single object lookup. Pipelines and bundles are cheap; trading the
  // ~3× build cost at init for jank-free toggle.
  const renderPipelines = createBlendableRenderPipelines(
    root,
    mainVertex,
    mainFragment,
    buffers,
    culling,
    // Scatter writes to the HDR target. The HDR composite pass converts to
    // the canvas swap chain format below.
    hdr.hdrFormat,
    backgroundColor,
    data.numCells,
    config?.render?.blendMode ?? "additive",
  );
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const { render } = renderPipelines;

  const selection = createSelectionEngine(
    root,
    device,
    buffers,
    uniforms,
    data.numCells,
    (count, indices) => {
      config?.callbacks?.onSelectionChange?.(count, indices);
    },
    preferredWorkgroupSize,
    compositor,
  );

  // Pre-allocated staging masks for row→point index conversion (avoids per-call allocation)
  const trajectoryStagingMask = new Uint32Array(data.numCells);
  const continuousStagingMask = new Uint32Array(data.numCells);
  const predicateFilterStagingMask = new Uint32Array(data.numCells);

  // ── GPU color-pack pipeline ────────────────────────────────────────────────
  // Instead of a O(n) CPU loop per palette change, pack colors on GPU:
  //   categoryBuffer[i] → paletteBuffer[cat] → colorBuffer[i]
  // CPU work per updateColors: O(palette_size) ≤ 64 entries (constant).
  const categoryReadonly = buffers.categoryBuffer.as("readonly");
  const colorMutable = buffers.colorBuffer.as("mutable");
  const paletteReadonly = buffers.paletteBuffer.as("readonly");
  const paletteLenUniform = buffers.paletteLenUniform;

  const colorPackPipeline = root.createGuardedComputePipeline((x: number) => {
    "use gpu";
    const idx = x;
    const numCats = paletteLenUniform.$;
    const cat = categoryReadonly.$[idx] % numCats;
    colorMutable.$[idx] = paletteReadonly.$[cat];
  });

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
    buffers.paletteBuffer.write(packed);
    buffers.paletteLenUniform.write(len);
    // If custom categoryIndices supplied (e.g. fresh from React), re-upload them first
    if (categoryIndices) {
      const catStaging = new Uint32Array(data.numCells);
      for (let i = 0; i < data.numCells; i++) catStaging[i] = categoryIndices[i]!;
      buffers.categoryBuffer.write(catStaging);
    }
    colorPackPipeline.dispatchThreads(data.numCells);
  }

  // ── Continuous color-pack pipeline (Phase 7) ───────────────────────────────
  // Reads raw value buffer + 256-entry packed-u32 LUT + config uniform,
  // writes packed u32 RGBA to the same colorBuffer as the categorical path.
  //   flags bit 0: reversed
  //   flags bits 1-2: scale mode (0 = linear, 1 = log, 2 = sqrt)
  const continuousValuesBuffer = root.createBuffer(d.arrayOf(d.f32, data.numCells)).$usage("storage");
  const continuousLutBuffer = root.createBuffer(d.arrayOf(d.u32, 256)).$usage("storage");
  const ContinuousConfig = d.struct({ vmin: d.f32, vmax: d.f32, flags: d.u32 });
  const continuousConfigUniform = root.createUniform(ContinuousConfig, { vmin: 0, vmax: 1, flags: 0 });

  const continuousValuesReadonly = continuousValuesBuffer.as("readonly");
  const continuousLutReadonly = continuousLutBuffer.as("readonly");

  // NaN → mid-gradient. Degenerate spans → clamped to 1e-20. Log scale is only
  // valid when vmin > 0 and value > 0; otherwise the branch falls back to
  // linear. Sqrt scale maps sqrt(v - vmin) / sqrt(span), which handles any
  // vmin/vmax but clamps v < vmin to 0.
  const continuousColorPackPipeline = root.createGuardedComputePipeline((x: number) => {
    "use gpu";
    const idx = x;
    const cfg = continuousConfigUniform.$;
    const v = continuousValuesReadonly.$[idx];

    const linearSpan = std.max(cfg.vmax - cfg.vmin, 1e-20);
    const tLinear = (v - cfg.vmin) / linearSpan;

    // Log: ln(v) − ln(vmin) / (ln(vmax) − ln(vmin)) when vmin > 0 AND v > 0.
    // Use tiny-but-positive fallback for the log args when the guard fails so
    // no NaN/Inf escapes; the `useLog` select below picks tLinear in that case.
    const vSafe = std.max(v, 1e-20);
    const vminSafe = std.max(cfg.vmin, 1e-20);
    const vmaxSafe = std.max(cfg.vmax, vminSafe * 10);
    const logSpan = std.max(std.log(vmaxSafe) - std.log(vminSafe), 1e-20);
    const tLog = (std.log(vSafe) - std.log(vminSafe)) / logSpan;

    // Sqrt: monotonic, defined for v ≥ vmin. Values < vmin clamp to 0.
    const sqrtSpan = std.max(std.sqrt(linearSpan), 1e-20);
    const tSqrt = std.sqrt(std.max(v - cfg.vmin, 0)) / sqrtSpan;

    const reversed = (cfg.flags & 1) !== 0;
    const scaleMode = (cfg.flags >> 1) & 3;
    const useLog = scaleMode === 1 && cfg.vmin > 0 && v > 0;
    const useSqrt = scaleMode === 2;

    let tRaw = std.select(tLinear, tLog, useLog);
    tRaw = std.select(tRaw, tSqrt, useSqrt);
    tRaw = std.select(tRaw, 0.5, v !== v); // NaN check: v !== v

    const tClamped = std.clamp(std.select(tRaw, 1 - tRaw, reversed), 0, 1);
    const lutIdx = d.u32(tClamped * 255);
    colorMutable.$[idx] = continuousLutReadonly.$[lutIdx];
  });

  // CPU mirror of the continuous config: lets partial setters (range only,
  // reversed only, lut only) re-emit the full uniform without reading GPU state.
  let currentContinuousVmin = 0;
  let currentContinuousVmax = 1;
  let currentContinuousFlags = 0;

  function writeContinuousConfig() {
    continuousConfigUniform.write({
      vmin: currentContinuousVmin,
      vmax: currentContinuousVmax,
      flags: currentContinuousFlags,
    });
  }

  function updateContinuousColors(args: {
    values: Float32Array;
    vmin: number;
    vmax: number;
    lut: Uint32Array;
    reversed: boolean;
    scale?: "linear" | "log" | "sqrt";
  }) {
    // Defense in depth for swapped range (see R4 in Phase 7 plan).
    currentContinuousVmin = Math.min(args.vmin, args.vmax);
    currentContinuousVmax = Math.max(args.vmin, args.vmax);
    const mode = args.scale === "log" ? 1 : args.scale === "sqrt" ? 2 : 0;
    currentContinuousFlags = (args.reversed ? 1 : 0) | (mode << 1);
    continuousValuesBuffer.write(args.values);
    continuousLutBuffer.write(args.lut);
    writeContinuousConfig();
    continuousColorPackPipeline.dispatchThreads(data.numCells);
  }

  function setContinuousRange(vmin: number, vmax: number) {
    currentContinuousVmin = Math.min(vmin, vmax);
    currentContinuousVmax = Math.max(vmin, vmax);
    writeContinuousConfig();
    continuousColorPackPipeline.dispatchThreads(data.numCells);
  }

  function setContinuousReversed(reversed: boolean) {
    currentContinuousFlags = (currentContinuousFlags & ~1) | (reversed ? 1 : 0);
    writeContinuousConfig();
    continuousColorPackPipeline.dispatchThreads(data.numCells);
  }

  function setContinuousScale(scale: "linear" | "log" | "sqrt") {
    const mode = scale === "log" ? 1 : scale === "sqrt" ? 2 : 0;
    currentContinuousFlags = (currentContinuousFlags & ~0b110) | (mode << 1);
    writeContinuousConfig();
    continuousColorPackPipeline.dispatchThreads(data.numCells);
  }

  function setContinuousLut(lut: Uint32Array) {
    continuousLutBuffer.write(lut);
    continuousColorPackPipeline.dispatchThreads(data.numCells);
  }

  const tPipelines = performance.now();
  console.log(`Pipeline setup: ${(tPipelines - tUpload).toFixed(1)}ms`);

  let currentZoom = 1;
  let viewVersion = 0;

  let pointPickRevision = 0;
  const interaction = createInteractionController(
    canvas,
    overlay,
    uniforms,
    selection,
    () => {
      // Guard against 0-size canvas (hidden/collapsed Dockview panel)
      if (canvas.width === 0 || canvas.height === 0) return;
      // Single encoder, single submit: cull → compositor → scatter (HDR) →
      // tonemap (canvas) in one batch.
      const encoder = device.createCommandEncoder();
      culling.dispatchCulling(viewVersion, encoder);
      compositor.dispatchIfDirty(encoder);
      // Scatter writes into the HDR target.
      render(hdr.hdrView(), data.numCells, "clear", encoder);
      // Tone-map composites HDR into the canvas.
      hdr.composite(context.getCurrentTexture().createView(), encoder);
      device.queue.submit([encoder.finish()]);
      // Conservatively invalidate the pick buffer on every render. Picks
      // happen on click (rarely), so re-rendering once per pick after a
      // state change is fine. Hover-driven picks would benefit from a
      // tighter cache, but ndea picks only on click for now.
      picking.markDirty();
    },
    {
      onViewChange: (state: ViewState) => {
        currentZoom = state.zoom;
        viewVersion++;
        // View change → pick buffer is stale. Cheap O(1) flag toggle.
        picking.markDirty();
        config?.callbacks?.onViewChange?.(state);
      },
      onFps: (fps: number) => {
        config?.callbacks?.onFps?.(fps);
      },
      onPointClick: (worldX: number, worldY: number, pixelX: number, pixelY: number) => {
        const revision = ++pointPickRevision;
        // Two paths:
        //   1. GPU pick (default, opt-out via `localStorage.ndea.useGpuPicking = '0'`):
        //      render to a cached pick buffer, sample 5×5 around the cursor,
        //      brightness-weighted vote. Picks the visually frontmost point.
        //   2. Legacy CPU grid (fallback): geometrically-nearest visible point.
        const useGpuPicking = localStorage?.getItem("ndea.useGpuPicking") !== "0";

        const finishHit = (idx: GpuPointIndex) => {
          if (idx >= 0 && idx < data.numCells && selection.isPointVisible(idx)) {
            selection.selectPoint(idx);
            const px = data.positions[idx * 2];
            const py = data.positions[idx * 2 + 1];
            const catIdx = data.categoryIndices[idx];
            config?.callbacks?.onPointClick?.(idx, [px, py], catIdx, data.categoryNames[catIdx]);
            return true;
          }
          return false;
        };

        const finishMiss = () => {
          selection.clearHighlight();
          config?.callbacks?.onBackgroundClick?.();
        };

        if (useGpuPicking) {
          // Async: readback is one frame on a clean buffer, ~1–2 frames on a
          // dirty rebuild. Latency is below human click perception.
          picking.pick(pixelX, pixelY).then(
            (result) => {
              if (revision !== pointPickRevision) return;
              if (result === null || !finishHit(result.pointIndex)) finishMiss();
            },
            (err: unknown) => {
              if (revision !== pointPickRevision) return;
              // GPU pick failed (rare). Fall through to the CPU grid path.
              console.warn("GPU pick failed, falling back to CPU grid:", err);
              cpuGridPick(worldX, worldY, finishHit, finishMiss);
            },
          );
          return;
        }

        cpuGridPick(worldX, worldY, finishHit, finishMiss);
      },
    },
    config?.interaction,
  );

  /**
   * Legacy CPU spatial-grid hit test: kept as fallback. Picks the
   * geometrically nearest visible point within a screen-space radius.
   * Loses to overlapping points (the GPU path handles that).
   */
  function cpuGridPick(worldX: number, worldY: number, hit: (i: GpuPointIndex) => boolean, miss: () => void) {
    const hitRadiusWorld = 20 / ((currentZoom * canvas.height) / 2);
    const maxDist2 = hitRadiusWorld * hitRadiusWorld;
    let bestIdx = -1;
    let bestDist2 = maxDist2;
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
          if (d2 < bestDist2 && selection.isPointVisible(i)) {
            bestDist2 = d2;
            bestIdx = i;
          }
        }
      }
    }
    if (bestIdx >= 0 && hit(gpuPointIndex(bestIdx))) return;
    miss();
  }

  // ── Row index → point index lookup (built once, used by setExternalSelection) ──
  // Pre-building this Map avoids O(n) reconstruction on every selection sync event.
  const rowToPoint = new Map<RowIndex, GpuPointIndex>(data.rowIndices.map((r, i) => [r, gpuPointIndex(i)]));

  // ── Grid spatial index for O(1) hit testing ───────────────────────────
  // World space is [-1,1]×[-1,1]. Divide into GRID×GRID cells; each cell
  // stores the indices of points that fall within it. onPointClick queries
  // only the 1–4 cells that overlap the hit radius instead of scanning all points.
  const GRID = 128;
  const gridCells: GpuPointIndex[][] = Array.from({ length: GRID * GRID }, () => []);
  for (let i = 0; i < data.numCells; i++) {
    const gx = Math.min(GRID - 1, Math.max(0, Math.floor(((data.positions[i * 2] + 1) / 2) * GRID)));
    const gy = Math.min(GRID - 1, Math.max(0, Math.floor(((data.positions[i * 2 + 1] + 1) / 2) * GRID)));
    gridCells[gx * GRID + gy]?.push(gpuPointIndex(i));
  }

  console.log(
    `Scatterplot ready: ${data.numCells.toLocaleString()} points in ${(performance.now() - t0).toFixed(1)}ms`,
  );

  // Debug: dump generated WGSL when ?debug-wgsl is in the URL
  if (typeof location !== "undefined" && new URLSearchParams(location.search).has("debug-wgsl")) {
    console.log("=== Vertex + Fragment WGSL ===");
    console.log(tgpu.resolve([mainVertex, mainFragment]));
    console.log("=== Compute kernels: guarded pipelines (WGSL not dumpable via resolve) ===");
  }

  /**
   * Resize every render-target-bearing subsystem in one call. Pick buffer +
   * HDR target. Adaptive-DPR (#4, deferred) plugs into this single seam.
   */
  function resizeAll(width: number, height: number) {
    const dpr = window.devicePixelRatio || 1;
    const gpuW = Math.max(1, Math.floor(width * dpr));
    const gpuH = Math.max(1, Math.floor(height * dpr));
    uniforms.paramsUniform.write(d.vec4f(pointRadius, gpuW / gpuH, selectionDimFactor, adaptiveScale));
    uniforms.pixelFloorUniform.write((2 * MIN_POINT_PIXEL_HALF) / gpuH);
    interaction.resize();
    picking.resize();
    hdr.resize(gpuW, gpuH);
  }

  return {
    resize(width: number, height: number) {
      resizeAll(width, height);
      // Re-render at the new size + aspect: otherwise the browser stretches the
      // stale old-size frame (warped/squished) until the next interaction.
      interaction.requestRender();
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
    setPointOpacity(opacity: number) {
      // Per-point alpha multiplier in [0.05, 1.0]. Drives how aggressively
      // points sum under additive blending.
      const clamped = Math.max(0.05, Math.min(1.0, opacity));
      // The GPU uniform retains its historical `sharpnessUniform` name to
      // avoid re-binding indices across the main + picking pipelines.
      uniforms.sharpnessUniform.write(clamped);
      interaction.requestRender();
    },
    setHdrSettings(settings) {
      hdr.setSettings(settings);
      interaction.requestRender();
    },
    setBlendMode(mode: BlendMode) {
      renderPipelines.setBlendMode(mode);
      interaction.requestRender();
    },
    updateColors(palette: readonly (readonly [number, number, number, number?])[], categoryIndices?: Uint8Array) {
      // GPU compute shader packs category indices → palette → colorBuffer.
      // CPU work: O(palette_size) ≤ 64 entries (constant, not O(numPoints)).
      gpuUpdateColors(palette, categoryIndices);
      interaction.requestRender();
    },
    updateContinuousColors(args) {
      updateContinuousColors(args);
      interaction.requestRender();
    },
    setContinuousRange(vmin: number, vmax: number) {
      setContinuousRange(vmin, vmax);
      interaction.requestRender();
    },
    setContinuousReversed(reversed: boolean) {
      setContinuousReversed(reversed);
      interaction.requestRender();
    },
    setContinuousScale(scale: "linear" | "log" | "sqrt") {
      setContinuousScale(scale);
      interaction.requestRender();
    },
    setContinuousLut(lut: Uint32Array) {
      setContinuousLut(lut);
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
    clearSelection() {
      selection.clearSelection();
      interaction.requestRender();
    },
    setExternalSelection(rowIndices: RowIndex[]) {
      const pointIndices: GpuPointIndex[] = [];
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
    setPredicateFilter(rowIndices: RowIndex[]) {
      predicateFilterStagingMask.fill(0);
      for (const rowIndex of rowIndices) {
        const pointIndex = rowToPoint.get(rowIndex);
        if (pointIndex !== undefined) predicateFilterStagingMask[pointIndex] = 1;
      }
      selection.setPredicateFilter(predicateFilterStagingMask);
      culling.invalidate();
      interaction.requestRender();
    },
    clearPredicateFilter() {
      selection.clearPredicateFilter();
      culling.invalidate();
      interaction.requestRender();
    },
    clearHighlight() {
      selection.clearHighlight();
      interaction.requestRender();
    },
    setHighlightPoints(rowIndices: RowIndex[]) {
      const pointIndices: GpuPointIndex[] = [];
      for (const r of rowIndices) {
        const i = rowToPoint.get(r);
        if (i !== undefined) pointIndices.push(i);
      }
      selection.setHighlightPoints(pointIndices);
      interaction.requestRender();
    },
    setCategoryIsolation(isolatedSet: Set<number>, categoryIndices: Uint8Array) {
      selection.setCategoryIsolation(isolatedSet, categoryIndices);
      interaction.requestRender();
    },
    clearCategoryIsolation() {
      selection.clearCategoryIsolation();
      interaction.requestRender();
    },
    setCategoryDisabled(disabledSet: Set<number>, categoryIndices: Uint8Array) {
      // No render dispatch needed: disabled categories already render
      // alpha=0 via legend's color-override. This only updates the click
      // filter so disabled points aren't pickable.
      selection.setCategoryDisabled(disabledSet, categoryIndices);
    },
    clearCategoryDisabled() {
      selection.clearCategoryDisabled();
    },
    setTrajectoryIsolation(rowIndices: RowIndex[]) {
      if (rowIndices.length === 0) {
        selection.clearTrajectoryIsolation();
      } else {
        trajectoryStagingMask.fill(0);
        for (const r of rowIndices) {
          const i = rowToPoint.get(r);
          if (i !== undefined) trajectoryStagingMask[i] = 1;
        }
        selection.setTrajectoryIsolation(trajectoryStagingMask);
      }
      interaction.requestRender();
    },
    clearTrajectoryIsolation() {
      selection.clearTrajectoryIsolation();
      interaction.requestRender();
    },
    setContinuousIsolation(rowIndices: RowIndex[]) {
      if (rowIndices.length === 0) {
        selection.clearContinuousIsolation();
        uniforms.filterHideUniform.write(0);
      } else {
        continuousStagingMask.fill(0);
        for (const r of rowIndices) {
          const i = rowToPoint.get(r);
          if (i !== undefined) continuousStagingMask[i] = 1;
        }
        selection.setContinuousIsolation(continuousStagingMask);
        uniforms.filterHideUniform.write(1);
      }
      interaction.requestRender();
    },
    clearContinuousIsolation() {
      selection.clearContinuousIsolation();
      uniforms.filterHideUniform.write(0);
      interaction.requestRender();
    },
    rehydrateIsolation() {
      selection.rehydrateIsolation();
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
      // Deterministic disposal order (PLUGIN-ARCHITECTURE §7.3): raw-device
      // owners free their own resources → context.unconfigure (§7.4) →
      // root.destroy (tgpu-owned) → release the device lease. A dev-only
      // validation error scope makes "no leaks" verified, not asserted.
      const auditLeaks = import.meta.env.DEV;
      if (auditLeaks) device.pushErrorScope("validation");

      interaction.destroy();
      selection.destroy();
      compositor.destroy();
      culling.destroy();
      picking.destroy();
      hdr.destroy();
      try {
        context.unconfigure();
      } catch {
        // Some browsers throw if the context was never configured: ignore.
      }
      root.destroy();

      if (auditLeaks) {
        device
          .popErrorScope()
          .then((err) => {
            if (err) console.error("[scatter dispose] GPU validation error:", err.message);
          })
          .catch(() => {
            // Device may already be released by the last lease holder: ignore.
          });
      }
      // Only the self-acquire path releases here. A host-leased device is
      // released by the lease owner (host.dispose), so it persists across this
      // instance's data swaps (PLUGIN-ARCHITECTURE §7.1).
    },
  };
}
