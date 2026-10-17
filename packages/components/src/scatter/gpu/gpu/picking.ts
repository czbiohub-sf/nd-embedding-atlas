/**
 * Render-to-texture picking system.
 *
 * The scatter's only hit test. luxar reference:
 * `packages/luxar-viewer/src/rendering/picking/picking-system.ts`.
 *
 * Why: when points overlap heavily the user clicks the visually frontmost
 * (brightest) point, not whichever neighbor is nearest in world space. The
 * pick buffer + brightness-as-depth ensures the brightest fragment at each
 * pixel wins.
 *
 * Pipeline:
 *  1. Render each instance to an `rgba32float` target with `depth32float`
 *     depth attachment, encoding `(pointIndex+1, 0, brightness, 1.0)` and
 *     writing `1 - brightness` to `frag_depth` (brightest wins under
 *     `depthCompare: 'less-equal'`).
 *  2. Cache the buffer until `markDirty()` is called (view change, data
 *     change, canvas resize).
 *  3. On hover/click, read back a 5×5 pixel window around the cursor,
 *     brightness-weighted vote → winning point index.
 *
 * Renders at half resolution to cut fragment work 4× (pick precision
 * degrades by ~1px which is fine for hover/click).
 *
 * The pick buffer shares the existing scatter vertex buffers
 * (positions, colors, selection, visibility): that's why we use raw
 * WebGPU for the pipeline instead of TypeGPU's render-pipeline shape:
 * we need to bind the same `quadBuffer`, `posBuffer`, `colorBuffer`,
 * `selectedBuffer`, and `visibilityBuffer` slots in the same order
 * the main render uses.
 */

import type { ScatterBuffers, ScatterUniforms } from "./buffers";
import type { CullingEngine } from "./culling";
import { PICK_FRAGMENT_WGSL, PICK_VERTEX_WGSL } from "./picking-shaders";
import type { TgpuRoot } from "../../gpu/types";
import { type GpuPointIndex, gpuPointIndex } from "../../contracts";

/** Width/height of the 5×5 readback window in pick-buffer pixels. */
const PICK_WINDOW = 5;

/** Sentinel for an empty pick (R == 0 means no point covered the fragment). */
const NO_HIT = 0;

export interface PickResult {
  /** Winning point index in the same numbering used by the rest of the system. */
  pointIndex: GpuPointIndex;
  /** Sum of brightness weights across the 5×5 window (debug / future tie-break). */
  brightness: number;
}

export interface PickingSystem {
  /** Mark the pick buffer stale: next pick re-renders before sampling. */
  markDirty(): void;
  /** Resize hook: invalidates the cached buffer and reallocates targets. */
  resize(): void;
  /**
   * Pick at canvas-CSS-pixel coordinates `(cssX, cssY)`. Resolves to the
   * winning point index or `null` for empty space. Re-renders the pick
   * buffer if dirty; otherwise samples the cache.
   */
  pick(cssX: number, cssY: number): Promise<PickResult | null>;
  /** Tear down GPU resources. */
  destroy(): void;
}

interface PickingTargets {
  colorTexture: GPUTexture;
  colorView: GPUTextureView;
  depthTexture: GPUTexture;
  depthView: GPUTextureView;
  width: number;
  height: number;
  /** Padded bytesPerRow for `copyTextureToBuffer` (must be a multiple of 256). */
  bytesPerRow: number;
}

export function createPickingSystem(
  root: TgpuRoot,
  canvas: HTMLCanvasElement,
  buffers: ScatterBuffers,
  uniforms: ScatterUniforms,
  culling: CullingEngine,
  numPoints: number,
): PickingSystem {
  const device = root.device;

  // ── Shader modules + pipeline ─────────────────────────────────────────
  const vertexModule = device.createShaderModule({ code: PICK_VERTEX_WGSL, label: "pick-vertex" });
  const fragmentModule = device.createShaderModule({ code: PICK_FRAGMENT_WGSL, label: "pick-fragment" });

  // Bind group layout: must match PICK_VERTEX_WGSL group(0) bindings.
  const bindGroupLayout = device.createBindGroupLayout({
    label: "pick-bgl",
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: "uniform" } },
      { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: "uniform" } },
      { binding: 2, visibility: GPUShaderStage.VERTEX, buffer: { type: "uniform" } },
      { binding: 3, visibility: GPUShaderStage.VERTEX, buffer: { type: "uniform" } },
      { binding: 4, visibility: GPUShaderStage.VERTEX, buffer: { type: "uniform" } },
      { binding: 5, visibility: GPUShaderStage.VERTEX, buffer: { type: "uniform" } },
    ],
  });

  // TgpuUniform → underlying GPUBuffer via `.buffer`. We avoid `root.unwrap`
  // here because its overload set rejects scalar (f32/u32) uniforms: the
  // shorthand `.buffer` accessor works for every shape.
  const bindGroup = device.createBindGroup({
    label: "pick-bg",
    layout: bindGroupLayout,
    entries: [
      { binding: 0, resource: { buffer: root.unwrap(uniforms.paramsUniform.buffer) } },
      { binding: 1, resource: { buffer: root.unwrap(uniforms.viewUniform.buffer) } },
      { binding: 2, resource: { buffer: root.unwrap(uniforms.selectionModeUniform.buffer) } },
      { binding: 3, resource: { buffer: root.unwrap(uniforms.filterHideUniform.buffer) } },
      { binding: 4, resource: { buffer: root.unwrap(uniforms.sharpnessUniform.buffer) } },
      { binding: 5, resource: { buffer: root.unwrap(uniforms.pixelFloorUniform.buffer) } },
    ],
  });

  const pipeline = device.createRenderPipeline({
    label: "pick-pipeline",
    layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
    vertex: {
      module: vertexModule,
      entryPoint: "main",
      buffers: [
        // Vertex layout: must match the main render's vertex buffer
        // bindings (slots 0..4 in the order the main pipeline assigns
        // them). The bundle in pipeline.ts uses:
        //   slot 0 = quadLayout (vec2f, "vertex")
        //   slot 1 = posLayout (vec2f, "instance")
        //   slot 2 = colorLayout (u32, "instance")
        //   slot 3 = selectedLayout (u32, "instance")
        //   slot 4 = visibilityLayout (u32, "instance")
        {
          arrayStride: 8,
          stepMode: "vertex",
          attributes: [{ shaderLocation: 0, offset: 0, format: "float32x2" }],
        },
        {
          arrayStride: 8,
          stepMode: "instance",
          attributes: [{ shaderLocation: 1, offset: 0, format: "float32x2" }],
        },
        {
          arrayStride: 4,
          stepMode: "instance",
          attributes: [{ shaderLocation: 2, offset: 0, format: "uint32" }],
        },
        {
          arrayStride: 4,
          stepMode: "instance",
          attributes: [{ shaderLocation: 3, offset: 0, format: "uint32" }],
        },
        {
          arrayStride: 4,
          stepMode: "instance",
          attributes: [{ shaderLocation: 4, offset: 0, format: "uint32" }],
        },
      ],
    },
    fragment: {
      module: fragmentModule,
      entryPoint: "main",
      targets: [{ format: "rgba32float" }],
    },
    primitive: { topology: "triangle-list" },
    depthStencil: {
      format: "depth32float",
      depthWriteEnabled: true,
      // Brightness-as-depth: smaller depth = brighter fragment. `less-equal`
      // (not `less`) lets the brightest fragment win ties between equally
      // bright neighbors instead of dropping silently.
      depthCompare: "less-equal",
    },
  });

  // ── Render targets (lazy, recreated on resize) ────────────────────────
  let targets: PickingTargets | null = null;

  function ensureTargets(): PickingTargets {
    const dpr = window.devicePixelRatio || 1;
    // Half resolution: luxar uses the same trick. Pick precision degrades
    // by ~1 px which is far inside the 5×5 readback window.
    const fullW = Math.max(1, Math.floor(canvas.clientWidth * dpr));
    const fullH = Math.max(1, Math.floor(canvas.clientHeight * dpr));
    const halfW = Math.max(1, Math.floor(fullW / 2));
    const halfH = Math.max(1, Math.floor(fullH / 2));
    if (targets?.width === halfW && targets.height === halfH) return targets;
    targets?.colorTexture.destroy();
    targets?.depthTexture.destroy();
    const colorTexture = device.createTexture({
      label: "pick-color",
      size: { width: halfW, height: halfH },
      format: "rgba32float",
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });
    const depthTexture = device.createTexture({
      label: "pick-depth",
      size: { width: halfW, height: halfH },
      format: "depth32float",
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    // bytesPerRow must be 256-aligned for copyTextureToBuffer; 16 bytes per
    // pixel (rgba32f) so width must be a multiple of 16. Round up.
    const bytesPerRow = Math.ceil((halfW * 16) / 256) * 256;
    targets = {
      colorTexture,
      colorView: colorTexture.createView(),
      depthTexture,
      depthView: depthTexture.createView(),
      width: halfW,
      height: halfH,
      bytesPerRow,
    };
    return targets;
  }

  // ── Cache + readback staging ──────────────────────────────────────────
  let dirty = true;
  // Reused readback buffer: rgba32f, sized for the largest plausible 5×5
  // readback (5 * 5 * 16 bytes = 400 B, but we copy the whole row range so
  // we round up to 256-aligned bytesPerRow).
  let readbackBuffer: GPUBuffer | null = null;
  let readbackBufferSize = 0;

  function ensureReadbackBuffer(bytesPerRow: number): GPUBuffer {
    // We copy PICK_WINDOW rows worth of bytes (each row padded to
    // bytesPerRow). One staging buffer suffices because picks are
    // serialized through `inflight`.
    const size = bytesPerRow * PICK_WINDOW;
    if (readbackBuffer && readbackBufferSize === size) return readbackBuffer;
    readbackBuffer?.destroy();
    readbackBuffer = device.createBuffer({
      label: "pick-readback",
      size,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    readbackBufferSize = size;
    return readbackBuffer;
  }

  // ── Render the pick buffer ────────────────────────────────────────────
  function renderPickBuffer(): void {
    const t = ensureTargets();
    const encoder = device.createCommandEncoder({ label: "pick-render" });
    const pass = encoder.beginRenderPass({
      label: "pick-pass",
      colorAttachments: [
        {
          view: t.colorView,
          // Clear to 0: fragments with R=0 mean "no hit" (we encoded
          // pointId as i+1 in the vertex shader so the first point is 1).
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: "clear",
          storeOp: "store",
        },
      ],
      depthStencilAttachment: {
        view: t.depthView,
        // 1.0 = "behind everything": first fragment is closer (smaller
        // 1-brightness).
        depthClearValue: 1.0,
        depthLoadOp: "clear",
        depthStoreOp: "store",
      },
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    // Re-bind the same vertex buffers the main render uses. Slots match
    // the layout we declared above.
    pass.setVertexBuffer(0, root.unwrap(buffers.quadBuffer));
    pass.setVertexBuffer(1, root.unwrap(buffers.posBuffer));
    pass.setVertexBuffer(2, root.unwrap(buffers.colorBuffer));
    pass.setVertexBuffer(3, root.unwrap(buffers.selectedBuffer));
    pass.setVertexBuffer(4, root.unwrap(culling.visibilityBuffer));
    pass.draw(6, numPoints);
    pass.end();
    device.queue.submit([encoder.finish()]);
  }

  // ── Pick + readback ───────────────────────────────────────────────────
  let inflight: Promise<unknown> | null = null;

  async function pick(cssX: number, cssY: number): Promise<PickResult | null> {
    // Serialize picks: overlapping mapAsync calls would interleave.
    if (inflight) await inflight;
    const job = (async (): Promise<PickResult | null> => {
      const t = ensureTargets();
      if (canvas.clientWidth === 0 || canvas.clientHeight === 0) return null;

      if (dirty) {
        renderPickBuffer();
        dirty = false;
      }

      // Cursor in pick-buffer pixels: pick buffer is at half DPR.
      // CSS pixels → DPR pixels → half-res.
      const dpr = window.devicePixelRatio || 1;
      const halfDpr = dpr / 2;
      const pxX = Math.floor(cssX * halfDpr);
      const pxY = Math.floor(cssY * halfDpr);

      const half = Math.floor(PICK_WINDOW / 2);
      const x0 = Math.max(0, Math.min(pxX - half, t.width - PICK_WINDOW));
      const y0 = Math.max(0, Math.min(pxY - half, t.height - PICK_WINDOW));

      const readback = ensureReadbackBuffer(t.bytesPerRow);
      const encoder = device.createCommandEncoder({ label: "pick-copy" });
      encoder.copyTextureToBuffer(
        { texture: t.colorTexture, origin: { x: x0, y: y0 } },
        { buffer: readback, bytesPerRow: t.bytesPerRow },
        { width: PICK_WINDOW, height: PICK_WINDOW },
      );
      device.queue.submit([encoder.finish()]);

      await readback.mapAsync(GPUMapMode.READ, 0, t.bytesPerRow * PICK_WINDOW);
      const range = readback.getMappedRange();
      const view = new Float32Array(range);
      // Brightness-weighted vote across the 5×5 window. Each row is
      // bytesPerRow / 4 floats wide; we only care about the first
      // PICK_WINDOW * 4 floats per row.
      const stride = t.bytesPerRow / 4; // floats per row
      const votes = new Map<number, number>(); // pointIndex → summed weight
      for (let row = 0; row < PICK_WINDOW; row++) {
        for (let col = 0; col < PICK_WINDOW; col++) {
          const base = row * stride + col * 4;
          const r = view[base]; // pointId + 1
          const b = view[base + 2]; // brightness
          if (r < 0.5) continue; // NO_HIT
          const id = Math.round(r) - 1;
          if (id < 0) continue;
          votes.set(id, (votes.get(id) ?? 0) + b);
        }
      }
      readback.unmap();

      if (votes.size === 0) return null;
      let bestId = -1;
      let bestWeight = 0;
      for (const [id, w] of votes) {
        if (w > bestWeight) {
          bestWeight = w;
          bestId = id;
        }
      }
      void NO_HIT; // documentation breadcrumb
      if (bestId < 0) return null;
      return { pointIndex: gpuPointIndex(bestId), brightness: bestWeight };
    })();
    const tracked = job.finally(() => {
      if (inflight === tracked) inflight = null;
    });
    inflight = tracked;
    return job;
  }

  return {
    markDirty() {
      dirty = true;
    },
    resize() {
      // Targets recreated lazily on the next pick; we just invalidate
      // and let `ensureTargets` notice the size change. Mark dirty so
      // we re-render at the new resolution.
      targets?.colorTexture.destroy();
      targets?.depthTexture.destroy();
      targets = null;
      dirty = true;
    },
    pick,
    destroy() {
      targets?.colorTexture.destroy();
      targets?.depthTexture.destroy();
      targets = null;
      readbackBuffer?.destroy();
      readbackBuffer = null;
    },
  };
}
