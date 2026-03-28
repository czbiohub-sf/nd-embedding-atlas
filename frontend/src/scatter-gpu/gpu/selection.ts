import tgpu from "typegpu";
import * as d from "typegpu/data";
import { computeFn } from "./tgpu-compat";
import { MAX_POLYGON_VERTS } from "../constants";
import { simplifyPath } from "../utils/geometry";
import type { TgpuRoot } from "../types";
import type { ScatterBuffers, ScatterUniforms } from "./buffers";

const DEBUG_SELECTION =
  typeof location !== "undefined" &&
  new URLSearchParams(location.search).has("debug-selection");


export function createSelectionEngine(
  root: TgpuRoot,
  device: GPUDevice,
  buffers: ScatterBuffers,
  uniforms: ScatterUniforms,
  numPoints: number,
  onSelectionChange: (count: number | null, indices?: number[]) => void,
  wgSize: 64 | 256 = 64,
) {
  const { selectionModeUniform } = uniforms;
  const { posBuffer, selectedBuffer } = buffers;

  const stagingBuffer = device.createBuffer({
    size: numPoints * 4,
    usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
  });
  let isReadingBack = false;

  const polygonBuffer = root
    .createBuffer(d.arrayOf(d.vec2f, MAX_POLYGON_VERTS))
    .$usage("storage");
  const polygonCountUniform = root.createUniform(d.u32, 0);

  const pointsReadonly  = posBuffer.as("readonly");
  const selectedMutable = selectedBuffer.as("mutable");
  const polygonReadonly = polygonBuffer.as("readonly");

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

  const pipComputeFn = computeFn({
    workgroupSize: [wgSize],
    in: { gid: d.builtin.globalInvocationId },
  })((input) => {
    "use gpu";
    const base     = input.gid.x * PIP_BATCH.length;
    const numVerts = polygonCountUniform.value;
    for (const k of tgpu.unroll(PIP_BATCH)) {
      const idx = base + k;
      if (idx < numPoints) {
        const pt = pointsReadonly.value[idx];
        if (pipTest(pt, numVerts)) {
          selectedMutable.value[idx] = 1;
        } else {
          selectedMutable.value[idx] = 0;
        }
      }
    }
  }).$uses({ pointsReadonly, selectedMutable, polygonCountUniform, pipTest });

  const pipPipeline = root["~unstable"]
    .withCompute(pipComputeFn)
    .createPipeline();
  const workgroups = Math.ceil(numPoints / (wgSize * PIP_BATCH.length));

  // ── AABB kernel ────────────────────────────────────────────────────────
  const AABB_BATCH = [0, 1] as const;
  const marqueeUniform = root.createUniform(d.vec4f, d.vec4f(0, 0, 0, 0));

  const aabbComputeFn = computeFn({
    workgroupSize: [wgSize],
    in: { gid: d.builtin.globalInvocationId },
  })((input) => {
    "use gpu";
    const base = input.gid.x * AABB_BATCH.length;
    const r    = marqueeUniform.value;
    for (const k of tgpu.unroll(AABB_BATCH)) {
      const idx = base + k;
      if (idx < numPoints) {
        const pt = pointsReadonly.value[idx];
        if (pt.x >= r.x && pt.x <= r.z && pt.y >= r.y && pt.y <= r.w) {
          selectedMutable.value[idx] = 1;
        } else {
          selectedMutable.value[idx] = 0;
        }
      }
    }
  }).$uses({ pointsReadonly, selectedMutable, marqueeUniform });

  const aabbPipeline = root["~unstable"]
    .withCompute(aabbComputeFn)
    .createPipeline();

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
          if (data[i]) { count++; indices.push(i); }
        }
        stagingBuffer.unmap();
        isReadingBack = false;
        console.log(`[${frame}] ${count.toLocaleString()} selected (${(performance.now()-t0).toFixed(1)}ms)`);
        onSelectionChange(count, indices);
      })
      .catch(() => { isReadingBack = false; });
  }

  function runLassoSelection(polygon: [number, number][], readback = true) {
    if (polygon.length < 3) return;
    const simplified = simplifyPath(polygon, 0.001);
    const vertCount  = Math.min(simplified.length, MAX_POLYGON_VERTS);
    const polyData   = simplified.slice(0, vertCount).map(([x, y]) => d.vec2f(x, y));
    while (polyData.length < MAX_POLYGON_VERTS) polyData.push(d.vec2f(0, 0));
    polygonBuffer.write(polyData);
    polygonCountUniform.write(vertCount);
    pipPipeline.dispatchWorkgroups(workgroups);
    selectionModeUniform.write(1);
    debugLogSelection();
    if (readback) readbackSelectionCount();
  }

  function runMarqueeSelection(
    rect: { xMin: number; yMin: number; xMax: number; yMax: number },
    readback = true,
  ) {
    marqueeUniform.write(d.vec4f(rect.xMin, rect.yMin, rect.xMax, rect.yMax));
    aabbPipeline.dispatchWorkgroups(workgroups);
    selectionModeUniform.write(1);
    debugLogSelection();
    if (readback) readbackSelectionCount();
  }

  // ── Debug ──────────────────────────────────────────────────────────────
  let debugPipeline: ReturnType<
    ReturnType<TgpuRoot["~unstable"]["withCompute"]>["createPipeline"]
  > | null = null;

  if (DEBUG_SELECTION) {
    const debugFn = computeFn({
      workgroupSize: [1],
      in: { gid: d.builtin.globalInvocationId },
    })((input) => {
      "use gpu";
      const idx = input.gid.x;
      const pt  = pointsReadonly.value[idx];
      const sel = selectedMutable.value[idx];
      const r   = marqueeUniform.value;
      console.log("pt", idx, "pos", pt, "sel", sel, "rect", r);
    });
    debugPipeline = root["~unstable"].withCompute(debugFn).createPipeline();
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
    selectionModeUniform.write(1);
    onSelectionChange(1, [index]);
  }

  function clearSelection() {
    selectionModeUniform.write(0);
    onSelectionChange(null);
  }

  return {
    runLassoSelection, runMarqueeSelection, selectPoint, clearSelection,
    debugLogSelection, pipComputeFn, aabbComputeFn,
    destroy() { stagingBuffer.destroy(); },
  };
}

export type SelectionEngine = ReturnType<typeof createSelectionEngine>;
