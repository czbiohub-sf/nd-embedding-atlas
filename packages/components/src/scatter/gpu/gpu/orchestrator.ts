import type { DeviceInfo, RowIndex } from "@ndea/sdk";
import { gpuPointIndex } from "../../contracts";
import { PALETTE } from "../../gpu/constants";
import { createInteractionController } from "../../gpu/hooks/useScatterInteraction";
import type { ScatterData, ScatterplotConfig, ScatterplotHandle } from "../../gpu/types";
import { PanZoom2D, transform } from "./camera";
import { createHdrPipeline, HDR_FORMAT } from "./hdr";
import { initGPU } from "./init";
import { createRenderPasses } from "./render";
import { Bit, createScene, type FrameState, LAYERS, NONE } from "./scene";
import { createSelectionEngine } from "./selection";

// ponytail: density LOD knob, calibrated on an M4 Max. Above DENSITY_POINTS_PER_PX visible
// points per device pixel the view swaps instanced quads for the density splat; it swaps back
// below DENSITY_HYSTERESIS of that. Raise it if a GPU draws quads fast enough, lower it if
// zoomed-out pans drop frames before the switch.
const DENSITY_POINTS_PER_PX = 0.5;
const DENSITY_HYSTERESIS = 0.8;
/** Capacity of the compacted id list; more visible points than this always take the density path. */
const MAX_QUADS = 1 << 21;
/** Storage buffers the point vertex shader binds: posX, posY, cats, values, ids, bits. */
const VERTEX_STORAGE_BUFFERS = 6;
/** Minimum marker half-size (device px): smaller, the fwidth disk AA reads as a square. */
const MIN_POINT_PX = 1.5;

export interface CreateScatterplotOpts {
  /** Aborted on host teardown. */
  signal?: AbortSignal;
  /**
   * Pre-acquired device lease from `host.acquireDeviceLease()`. The lease owner
   * (`host.dispose`) controls the device lifetime, so the device survives data
   * swaps. Typed structurally to avoid a `scatter-gpu → core` import cycle.
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
  const { root, device, context, format } = initGPU(canvas, opts.lease.info);
  const n = data.numCells;

  // Known limit: no vertex-buffer fallback for devices without vertex-stage storage buffers.
  const vertexStorage = device.limits.maxStorageBuffersInVertexStage ?? device.limits.maxStorageBuffersPerShaderStage;
  if (vertexStorage < VERTEX_STORAGE_BUFFERS) {
    throw new Error(
      `This GPU allows ${vertexStorage} storage buffers in vertex shaders; the scatter needs ${VERTEX_STORAGE_BUFFERS}.`,
    );
  }
  if (n * 4 > device.limits.maxStorageBufferBindingSize) {
    throw new Error(
      `${n.toLocaleString()} points exceed this GPU's storage binding limit (${device.limits.maxStorageBufferBindingSize.toLocaleString()} bytes per column).`,
    );
  }

  const scene = createScene(root, n, Math.min(n, MAX_QUADS));
  const xs = new Float32Array(n);
  const ys = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    xs[i] = data.positions[2 * i];
    ys[i] = data.positions[2 * i + 1];
  }
  scene.posX.write(xs);
  scene.posY.write(ys);
  writeCategories(data.categoryIndices);
  const tUpload = performance.now();
  console.log(`Buffer upload: ${(tUpload - t0).toFixed(1)}ms`);

  let pointRadius = config?.render?.pointRadius ?? 0.002;
  // Point size scales with count once (zoom-dependent sizing is sqrt(zoom) per frame).
  const adaptiveScale = Math.max(0.3, Math.min(1.5, Math.sqrt(50_000 / Math.max(1, n))));
  const f: FrameState = {
    viewProj: new Float32Array(16),
    viewport: [1, 1],
    pointPx: MIN_POINT_PX,
    opacity: config?.render?.pointOpacity ?? 1,
    dim: config?.render?.selectionDimFactor ?? 0.08,
    vmin: 0,
    vmax: 1,
    n,
    words: scene.words,
    flags: 0,
    clicked: NONE,
    colorBy: 0,
    reversed: 0,
    paletteLen: 1,
    densityHi: 0,
    densityLo: 0,
    cap: scene.cap,
    grid: [1, 1],
  };
  setPalette(PALETTE.map(([r, g, b]) => [r / 255, g / 255, b / 255] as const));

  const camera = new PanZoom2D(config?.interaction);
  const hdr = createHdrPipeline(root, format);
  const passes = createRenderPasses(root, scene, HDR_FORMAT);
  const selection = createSelectionEngine(root, scene, (count, bits) =>
    config?.callbacks?.onSelectionChange?.(count, bits),
  );
  // Compaction reruns only when the camera, a filter, or the data changed.
  let compactDirty = true;

  function writeCategories(indices: Uint8Array) {
    const bytes = new Uint8Array(Math.max(1, Math.ceil(n / 4)) * 4);
    bytes.set(indices.subarray(0, n));
    scene.cats.write(new Uint32Array(bytes.buffer));
  }

  function setPalette(palette: readonly (readonly [number, number, number, number?])[]) {
    const len = Math.max(1, Math.min(palette.length, 256));
    const rgba = new Float32Array(256 * 4);
    for (let i = 0; i < Math.min(palette.length, 256); i++) {
      const [r, g, b, a = 1] = palette[i];
      rgba.set([r, g, b, a], i * 4);
    }
    scene.colors.write(rgba);
    f.paletteLen = len;
    f.colorBy = 0;
  }

  function setLut(lut: Uint32Array) {
    const rgba = new Float32Array(256 * 4);
    for (let i = 0; i < 256; i++) for (let c = 0; c < 4; c++) rgba[i * 4 + c] = ((lut[i] >>> (c * 8)) & 0xff) / 255;
    scene.colors.write(rgba);
  }

  function setScale(scale: "linear" | "log" | "sqrt" = "linear") {
    f.colorBy = scale === "log" ? 2 : scale === "sqrt" ? 3 : 1;
  }

  /** Frame state changed in a way that can change which points are drawn. */
  function invalidate() {
    compactDirty = true;
    interaction.requestRender();
  }

  function setFlag(bit: number, on: boolean) {
    f.flags = on ? f.flags | (1 << bit) : f.flags & ~(1 << bit);
    invalidate();
  }

  /** Bit layer from a row list (row index = point index); empty → layer off. */
  function setRows(bit: number, rows: readonly number[]) {
    if (rows.length > 0) {
      const words = new Uint32Array(scene.words);
      for (const r of rows) if (r < n) words[r >>> 5] |= 1 << (r & 31);
      device.queue.writeBuffer(root.unwrap(scene.bits), bit * scene.words * 4, words);
    }
    setFlag(bit, rows.length > 0);
  }

  /** 256-category bitset: 0 = isolated, 1 = disabled. */
  function setCategories(set: 0 | 1, categories: Set<number>) {
    const words = new Uint32Array(8);
    for (const c of categories) if (c < 256) words[c >>> 5] |= 1 << (c & 31);
    device.queue.writeBuffer(root.unwrap(scene.bits), (LAYERS * scene.words + set * 8) * 4, words);
    setFlag(set === 0 ? Bit.isolated : Bit.disabled, categories.size > 0);
  }

  /** Camera and canvas → frame uniform. */
  function sync() {
    const { width, height } = canvas;
    f.viewProj = camera.viewProj(width / height);
    f.viewport = [width, height];
    f.pointPx = Math.max(
      (pointRadius * Math.sqrt(camera.toViewState().zoom) * adaptiveScale * height) / 2,
      MIN_POINT_PX,
    );
    scene.frame.write(f);
  }

  function render() {
    // 0-size canvas: hidden/collapsed panel.
    if (canvas.width === 0 || canvas.height === 0) return;
    sync();
    const enc = root["~unstable"].createCommandEncoder();
    if (compactDirty) passes.compact(enc);
    compactDirty = false;
    passes.draw(enc, hdr.target());
    hdr.composite(enc, context);
    enc.submit();
  }

  function resizeTargets() {
    const width = Math.max(1, canvas.width);
    const height = Math.max(1, canvas.height);
    const pixels = width * height;
    f.densityHi = Math.round(DENSITY_POINTS_PER_PX * pixels);
    f.densityLo = Math.round(DENSITY_POINTS_PER_PX * DENSITY_HYSTERESIS * pixels);
    f.grid = [width, height];
    hdr.resize(width, height);
    passes.resize(width, height, n > f.densityLo || n > scene.cap);
  }

  let pickRevision = 0;
  const interaction = createInteractionController(
    overlay,
    camera,
    render,
    {
      onViewChange: (state) => {
        compactDirty = true;
        config?.callbacks?.onViewChange?.(state);
      },
      onFps: (fps) => config?.callbacks?.onFps?.(fps),
      onSelect: (paint, final) => {
        sync();
        selection.run(paint, overlay.clientWidth, overlay.clientHeight, final);
        setFlag(Bit.lasso, true);
      },
      onPointClick: (cssX, cssY) => {
        const revision = ++pickRevision;
        const scale = canvas.width / Math.max(1, overlay.clientWidth);
        sync();
        passes.pick(cssX * scale, cssY * scale, compactDirty).then(
          (idx) => {
            if (revision !== pickRevision) return;
            if (idx === null) {
              f.clicked = NONE;
              setFlag(Bit.highlight, false);
              config?.callbacks?.onBackgroundClick?.();
              return;
            }
            f.clicked = idx;
            invalidate();
            const cat = data.categoryIndices[idx];
            config?.callbacks?.onPointClick?.(
              gpuPointIndex(idx),
              [data.positions[2 * idx], data.positions[2 * idx + 1]],
              cat,
              data.categoryNames[cat],
            );
          },
          (err: unknown) => console.warn("GPU pick failed:", err),
        );
      },
    },
    config?.interaction,
  );
  resizeTargets();

  const pointBytes = [
    scene.posX.buffer,
    scene.posY.buffer,
    scene.cats.buffer,
    scene.values.buffer,
    scene.bits,
    scene.ids,
  ]
    .map((b) => root.unwrap(b).size)
    .reduce((a, b) => a + b, 0);
  console.log(
    `Scatterplot ready: ${n.toLocaleString()} points in ${(performance.now() - t0).toFixed(1)}ms, ${(pointBytes / Math.max(1, n)).toFixed(2)} B/pt`,
  );

  return {
    resize() {
      resizeTargets();
      // Re-render now: otherwise the browser stretches the stale frame until the next interaction.
      invalidate();
      interaction.resize();
    },
    setPointRadius(r) {
      pointRadius = r;
      invalidate();
    },
    setPointOpacity(opacity) {
      f.opacity = Math.max(0.05, Math.min(1, opacity));
      interaction.requestRender();
    },
    setHdrSettings(settings) {
      hdr.setSettings(settings);
      interaction.requestRender();
    },
    setBlendMode(mode) {
      passes.setBlendMode(mode);
      interaction.requestRender();
    },
    updateColors(palette, categoryIndices) {
      setPalette(palette);
      if (categoryIndices) {
        writeCategories(categoryIndices);
        invalidate();
      } else interaction.requestRender();
    },
    updateContinuousColors(args) {
      scene.values.write(args.values.subarray(0, n));
      setLut(args.lut);
      f.vmin = Math.min(args.vmin, args.vmax);
      f.vmax = Math.max(args.vmin, args.vmax);
      f.reversed = args.reversed ? 1 : 0;
      setScale(args.scale);
      interaction.requestRender();
    },
    setContinuousRange(vmin, vmax) {
      f.vmin = Math.min(vmin, vmax);
      f.vmax = Math.max(vmin, vmax);
      interaction.requestRender();
    },
    setContinuousReversed(reversed) {
      f.reversed = reversed ? 1 : 0;
      interaction.requestRender();
    },
    setContinuousScale(scale) {
      setScale(scale);
      interaction.requestRender();
    },
    setContinuousLut(lut) {
      setLut(lut);
      interaction.requestRender();
    },
    getViewState: () => camera.toViewState(),
    project(x, y, z = 0) {
      const w = overlay.clientWidth;
      const h = overlay.clientHeight;
      const [cx, cy, , cw] = transform(camera.viewProj(w / h || 1), x, y, z);
      return { x: ((cx / cw + 1) / 2) * w, y: ((1 - cy / cw) / 2) * h };
    },
    clearSelection() {
      selection.clear();
      setFlag(Bit.lasso, false);
      config?.callbacks?.onSelectionChange?.(null);
    },
    setExternalSelection(rowIndices: RowIndex[]) {
      setRows(Bit.external, rowIndices);
    },
    clearExternalSelection() {
      setFlag(Bit.external, false);
      config?.callbacks?.onExternalClear?.();
    },
    setPredicateFilter(bits) {
      const words = new Uint32Array(scene.words);
      words.set(bits.subarray(0, scene.words));
      device.queue.writeBuffer(root.unwrap(scene.bits), Bit.predicate * scene.words * 4, words);
      setFlag(Bit.predicate, true);
    },
    clearPredicateFilter() {
      setFlag(Bit.predicate, false);
    },
    clearHighlight() {
      f.clicked = NONE;
      setFlag(Bit.highlight, false);
    },
    setHighlightPoints(rowIndices) {
      setRows(Bit.highlight, rowIndices);
    },
    setCategoryIsolation(isolated) {
      setCategories(0, isolated);
    },
    clearCategoryIsolation() {
      setFlag(Bit.isolated, false);
    },
    setCategoryDisabled(disabled) {
      setCategories(1, disabled);
    },
    clearCategoryDisabled() {
      setFlag(Bit.disabled, false);
    },
    setTrajectoryIsolation(rowIndices) {
      setRows(Bit.trajectory, rowIndices);
    },
    clearTrajectoryIsolation() {
      setFlag(Bit.trajectory, false);
    },
    // Continuous range: out-of-range points are hidden, not dimmed.
    setContinuousIsolation(rowIndices) {
      setRows(Bit.continuous, rowIndices);
      setFlag(Bit.hideDimmed, rowIndices.length > 0);
    },
    clearContinuousIsolation() {
      setFlag(Bit.continuous, false);
      setFlag(Bit.hideDimmed, false);
    },
    setForcedSelectionMode(mode) {
      interaction.setForcedSelectionMode(mode);
    },
    setViewState(state) {
      interaction.setViewState(state);
    },
    animateToViewState(state, durationMs) {
      interaction.animateToViewState(state, durationMs);
    },
    destroy() {
      // Dev-only validation scope: "no leaks" is checked, not assumed.
      const auditLeaks = process.env.NODE_ENV !== "production";
      if (auditLeaks) device.pushErrorScope("validation");
      interaction.destroy();
      selection.destroy();
      passes.destroy();
      hdr.destroy();
      try {
        context.unconfigure();
      } catch {
        // Some browsers throw if the context was never configured.
      }
      root.destroy();
      if (auditLeaks) {
        device
          .popErrorScope()
          .then((err) => {
            if (err) console.error("[scatter dispose] GPU validation error:", err.message);
          })
          .catch(() => {
            // The last lease holder may already have released the device.
          });
      }
    },
  };
}
