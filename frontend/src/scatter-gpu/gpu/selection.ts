import tgpu from "typegpu";
import * as d from "typegpu/data";
import { MAX_POLYGON_VERTS } from "../constants";
import type { TgpuRoot } from "../types";
import { simplifyPath } from "../utils/geometry";
import type { ScatterBuffers } from "./buffers";
import { type CompositorEngine, LAYER_ISOLATION, LAYER_LASSO } from "./compositor";

const DEBUG_SELECTION = typeof location !== "undefined" && new URLSearchParams(location.search).has("debug-selection");

export function createSelectionEngine(
  root: TgpuRoot,
  device: GPUDevice,
  buffers: ScatterBuffers,
  numPoints: number,
  onSelectionChange: (count: number | null, indices?: number[]) => void,
  wgSize: 64 | 256 = 64,
  compositor: CompositorEngine,
) {
  const { posBuffer, selectedBuffer } = buffers;

  const stagingBuffer = device.createBuffer({
    size: numPoints * 4,
    usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
  });
  let isReadingBack = false;

  const polygonBuffer = root.createBuffer(d.arrayOf(d.vec2f, MAX_POLYGON_VERTS)).$usage("storage");
  const polygonCountUniform = root.createUniform(d.u32, 0);

  const pointsReadonly = posBuffer.as("readonly");
  const selectedMutable = selectedBuffer.as("mutable");
  const polygonReadonly = polygonBuffer.as("readonly");

  // Buffer view into the compositor's lasso layer
  const lassoMutable = compositor.lassoBuffer.as("mutable");

  // ── PIP kernel ─────────────────────────────────────────────────────────
  const PIP_BATCH = [0, 1] as const;

  // Raw WGSL for the inner dynamic loop (numVerts is runtime, cannot unroll)
  const pipTest = tgpu.fn([d.vec2f, d.u32], d.bool)`
    (pt: vec2f, numVerts: u32) -> bool {
      var c = false;
      var j = numVerts - 1u;
      for (var i = 0u; i < numVerts; i++) {
        let vi = polygon[i];
        let vj = polygon[j];
        let b = (vi.y <= pt.y && pt.y < vj.y) || (vj.y <= pt.y && pt.y < vi.y);
        if (b) {
          let xd = (vj.x - vi.x) * (pt.y - vi.y) / (vj.y - vi.y) + vi.x;
          if (pt.x < xd) { c = !c; }
        }
        j = i;
      }
      return c;
    }
  `.$uses({ polygon: polygonReadonly });

  const pipComputeFn = tgpu
    .computeFn({
      workgroupSize: [wgSize],
      in: { gid: d.builtin.globalInvocationId },
    })((input) => {
      "use gpu";
      const base = input.gid.x * PIP_BATCH.length;
      const numVerts = polygonCountUniform.$;
      for (const k of tgpu.unroll(PIP_BATCH)) {
        const idx = base + k;
        if (idx < numPoints) {
          const pt = pointsReadonly.$[idx];
          if (pipTest(pt, numVerts)) {
            lassoMutable.$[idx] = 1;
          } else {
            lassoMutable.$[idx] = 0;
          }
        }
      }
    })
    .$uses({ pointsReadonly, lassoMutable, polygonCountUniform, pipTest });

  const pipPipeline = root.createComputePipeline({ compute: pipComputeFn });
  const workgroups = Math.ceil(numPoints / (wgSize * PIP_BATCH.length));

  // ── AABB kernel ────────────────────────────────────────────────────────
  const AABB_BATCH = [0, 1, 2, 3] as const;
  const marqueeUniform = root.createUniform(d.vec4f, d.vec4f(0, 0, 0, 0));

  const aabbComputeFn = tgpu
    .computeFn({
      workgroupSize: [wgSize],
      in: { gid: d.builtin.globalInvocationId },
    })((input) => {
      "use gpu";
      const base = input.gid.x * AABB_BATCH.length;
      const r = marqueeUniform.$;
      for (const k of tgpu.unroll(AABB_BATCH)) {
        const idx = base + k;
        if (idx < numPoints) {
          const pt = pointsReadonly.$[idx];
          if (pt.x >= r.x && pt.x <= r.z && pt.y >= r.y && pt.y <= r.w) {
            lassoMutable.$[idx] = 1;
          } else {
            lassoMutable.$[idx] = 0;
          }
        }
      }
    })
    .$uses({ pointsReadonly, lassoMutable, marqueeUniform });

  const aabbPipeline = root.createComputePipeline({ compute: aabbComputeFn });
  const aabbWorkgroups = Math.ceil(numPoints / (wgSize * AABB_BATCH.length));

  // ── Readback ───────────────────────────────────────────────────────────
  let readbackFrame = 0;
  function readbackSelectionCount() {
    if (isReadingBack) return;
    isReadingBack = true;
    readbackFrame++;
    const frame = readbackFrame;
    const t0 = performance.now();

    const rawSelectedBuffer = root.unwrap(selectedBuffer);
    const encoder = device.createCommandEncoder();
    encoder.copyBufferToBuffer(rawSelectedBuffer, 0, stagingBuffer, 0, numPoints * 4);
    device.queue.submit([encoder.finish()]);

    stagingBuffer
      .mapAsync(GPUMapMode.READ)
      .then(() => {
        const data = new Uint32Array(stagingBuffer.getMappedRange());
        let count = 0;
        const indices: number[] = [];
        for (let i = 0; i < data.length; i++) {
          if (data[i]) {
            count++;
            indices.push(i);
          }
        }
        stagingBuffer.unmap();
        isReadingBack = false;
        console.log(`[${frame}] ${count.toLocaleString()} selected (${(performance.now() - t0).toFixed(1)}ms)`);
        onSelectionChange(count, indices);
      })
      .catch(() => {
        isReadingBack = false;
      });
  }

  function runLassoSelection(polygon: [number, number][], readback = true) {
    if (polygon.length < 3) return;
    const simplified = simplifyPath(polygon, 0.001);
    const vertCount = Math.min(simplified.length, MAX_POLYGON_VERTS);
    const polyData = simplified.slice(0, vertCount).map(([x, y]) => d.vec2f(x, y));
    while (polyData.length < MAX_POLYGON_VERTS) polyData.push(d.vec2f(0, 0));
    polygonBuffer.write(polyData);
    polygonCountUniform.write(vertCount);
    pipPipeline.dispatchWorkgroups(workgroups);
    compositor.markDirty(LAYER_LASSO, true);
    debugLogSelection();
    if (readback) readbackSelectionCount();
  }

  function runMarqueeSelection(rect: { xMin: number; yMin: number; xMax: number; yMax: number }, readback = true) {
    marqueeUniform.write(d.vec4f(rect.xMin, rect.yMin, rect.xMax, rect.yMax));
    aabbPipeline.dispatchWorkgroups(aabbWorkgroups);
    compositor.markDirty(LAYER_LASSO, true);
    debugLogSelection();
    if (readback) readbackSelectionCount();
  }

  // ── Debug ──────────────────────────────────────────────────────────────
  let debugPipeline: ReturnType<TgpuRoot["createComputePipeline"]> | null = null;

  if (DEBUG_SELECTION) {
    const debugFn = tgpu.computeFn({
      workgroupSize: [1],
      in: { gid: d.builtin.globalInvocationId },
    })((input) => {
      "use gpu";
      const idx = input.gid.x;
      const pt = pointsReadonly.$[idx];
      const sel = selectedMutable.$[idx];
      const r = marqueeUniform.$;
      console.log("pt", idx, "pos", pt, "sel", sel, "rect", r);
    });
    debugPipeline = root.createComputePipeline({ compute: debugFn });
  }

  function debugLogSelection(sampleCount = 8) {
    if (!debugPipeline || !DEBUG_SELECTION) return;
    debugPipeline.dispatchWorkgroups(sampleCount);
  }

  function selectPoint(index: number) {
    const rawBuf = root.unwrap(selectedBuffer);
    const encoder = device.createCommandEncoder();
    encoder.clearBuffer(rawBuf);
    device.queue.submit([encoder.finish()]);
    device.queue.writeBuffer(rawBuf, index * 4, new Uint32Array([1]));
    onSelectionChange(1, [index]);
  }

  // Pre-allocated mask — reused on every external selection update to avoid
  // O(n) heap allocation per sync event (critical for 455K+ point datasets).
  const externalSelectionMask = new Uint32Array(numPoints);

  function setSelectedPoints(pointIndices: number[]) {
    externalSelectionMask.fill(0);
    for (const idx of pointIndices) {
      if (idx >= 0 && idx < numPoints) externalSelectionMask[idx] = 1;
    }
    device.queue.writeBuffer(root.unwrap(selectedBuffer), 0, externalSelectionMask);
  }

  function clearSelectionExternal() {
    externalSelectionMask.fill(0);
    device.queue.writeBuffer(root.unwrap(selectedBuffer), 0, externalSelectionMask);
    // Do NOT call onSelectionChange here — that path calls clearSelectionSync,
    // which notifies other panels, which call clearExternalSelection, which loops.
    // Status bar is updated via the separate onExternalClear callback in orchestrator.
  }

  // ── Category isolation ─────────────────────────────────────────────────

  /**
   * Dim all points whose category index is NOT in `isolatedSet`.
   * Pass an empty Set (or call clearCategoryIsolation) to remove isolation.
   * Uses the same alpha-dimming path as lasso/marquee selection.
   */
  function setCategoryIsolation(isolatedSet: Set<number>, categoryIndices: Uint8Array) {
    if (isolatedSet.size === 0) {
      clearCategoryIsolation();
      return;
    }
    const mask = new Uint32Array(numPoints);
    for (let i = 0; i < numPoints; i++) {
      if (isolatedSet.has(categoryIndices[i])) mask[i] = 1;
    }
    setIsolationMask(mask);
  }

  function clearCategoryIsolation() {
    setIsolationMask(null);
  }

  /**
   * Apply a pre-built isolation mask directly (e.g. from a continuous range filter).
   * Pass null to clear. Mask persists through lasso/marquee clear.
   */
  function setIsolationMask(mask: Uint32Array | null) {
    if (mask) {
      device.queue.writeBuffer(root.unwrap(compositor.isolationBuffer), 0, mask);
      compositor.markDirty(LAYER_ISOLATION, true);
    } else {
      // Clear the isolation buffer and mark the layer inactive
      const encoder = device.createCommandEncoder();
      encoder.clearBuffer(root.unwrap(compositor.isolationBuffer));
      device.queue.submit([encoder.finish()]);
      compositor.markDirty(LAYER_ISOLATION, false);
    }
  }

  return {
    runLassoSelection,
    runMarqueeSelection,
    selectPoint,
    clearSelection() {
      // Zero the lasso layer and mark it inactive. If isolation is active,
      // the compositor will keep it visible via the isolation tier.
      const encoder = device.createCommandEncoder();
      encoder.clearBuffer(root.unwrap(compositor.lassoBuffer));
      device.queue.submit([encoder.finish()]);
      compositor.markDirty(LAYER_LASSO, false);
      onSelectionChange(null);
    },
    setSelectedPoints,
    clearSelectionExternal,
    setCategoryIsolation,
    clearCategoryIsolation,
    setIsolationMask,
    debugLogSelection,
    pipComputeFn,
    aabbComputeFn,
    destroy() {
      stagingBuffer.destroy();
    },
  };
}

export type SelectionEngine = ReturnType<typeof createSelectionEngine>;
