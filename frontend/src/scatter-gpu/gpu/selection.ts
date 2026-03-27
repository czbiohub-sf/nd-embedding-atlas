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
) {
  const { selectionModeUniform } = uniforms;
  const { posBuffer, selectedBuffer } = buffers;

  // Staging buffer for async readback (MAP_READ + COPY_DST)
  const stagingBuffer = device.createBuffer({
    size: numPoints * 4,
    usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
  });
  let isReadingBack = false;

  // Lasso polygon buffer + vertex count
  const polygonBuffer = root
    .createBuffer(d.arrayOf(d.vec2f, MAX_POLYGON_VERTS))
    .$usage("storage");
  const polygonCountUniform = root.createUniform(d.u32, 0);

  // Buffer accessors for compute shader
  const pointsReadonly = posBuffer.as("readonly");
  const selectedMutable = selectedBuffer.as("mutable");
  const polygonReadonly = polygonBuffer.as("readonly");

  // PIP kernel with batch unrolling (batch=2 is optimal from benchmarks)
  const batchSize = 2;
  let batchBody = "";
  for (let k = 0; k < batchSize; k++) {
    batchBody += `
    {
      let idx = base + ${k}u;
      if (idx < ${numPoints}u) {
        let pt = points[idx];
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
        selected[idx] = select(0u, 1u, c);
      }
    }`;
  }

  const pipComputeFn = computeFn({
    workgroupSize: [256],
    in: { gid: d.builtin.globalInvocationId },
  })`{
    let base = in.gid.x * ${batchSize}u;
    let numVerts = polygonCount;
    ${batchBody}
  }`.$uses({
    points: pointsReadonly,
    selected: selectedMutable,
    polygon: polygonReadonly,
    polygonCount: polygonCountUniform,
  });

  const pipPipeline = root["~unstable"]
    .withCompute(pipComputeFn)
    .createPipeline();
  const workgroups = Math.ceil(numPoints / (256 * batchSize));

  // --- AABB (marquee) selection compute shader ---
  const marqueeUniform = root.createUniform(d.vec4f, d.vec4f(0, 0, 0, 0));

  let aabbBody = "";
  for (let k = 0; k < batchSize; k++) {
    aabbBody += `
    {
      let idx = base + ${k}u;
      if (idx < ${numPoints}u) {
        let pt = points[idx];
        let r = rect;
        selected[idx] = select(0u, 1u,
          pt.x >= r.x && pt.x <= r.z && pt.y >= r.y && pt.y <= r.w
        );
      }
    }`;
  }

  const aabbComputeFn = computeFn({
    workgroupSize: [256],
    in: { gid: d.builtin.globalInvocationId },
  })`{
    let base = in.gid.x * ${batchSize}u;
    ${aabbBody}
  }`.$uses({
    points: pointsReadonly,
    selected: selectedMutable,
    rect: marqueeUniform,
  });

  const aabbPipeline = root["~unstable"]
    .withCompute(aabbComputeFn)
    .createPipeline();

  // --- Shared readback logic ---
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
        const dt = performance.now() - t0;
        console.log(`[${frame}] ${count.toLocaleString()} selected (${dt.toFixed(1)}ms)`);
        onSelectionChange(count, indices);
      })
      .catch(() => { isReadingBack = false; });
  }

  /**
   * Dispatch lasso PIP compute + optional readback.
   * @param readback If false, only updates selectedBuffer (visual) without readback (fast).
   */
  function runLassoSelection(polygon: [number, number][], readback = true) {
    if (polygon.length < 3) return;

    const simplified = simplifyPath(polygon, 0.001);
    const vertCount = Math.min(simplified.length, MAX_POLYGON_VERTS);

    const polyData = simplified
      .slice(0, vertCount)
      .map(([x, y]) => d.vec2f(x, y));
    while (polyData.length < MAX_POLYGON_VERTS) {
      polyData.push(d.vec2f(0, 0));
    }
    polygonBuffer.write(polyData);
    polygonCountUniform.write(vertCount);

    pipPipeline.dispatchWorkgroups(workgroups);
    selectionModeUniform.write(1);
    debugLogSelection();
    if (readback) readbackSelectionCount();
  }

  /**
   * Dispatch marquee AABB compute + optional readback.
   * @param readback If false, only updates selectedBuffer (visual) without readback (fast).
   */
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

  // --- Debug: GPU-side console.log for selection inspection ---
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
      const pt = pointsReadonly.value[idx];
      const sel = selectedMutable.value[idx];
      const r = marqueeUniform.value;
      console.log("pt", idx, "pos", pt, "sel", sel, "rect", r);
    });

    debugPipeline = root["~unstable"].withCompute(debugFn).createPipeline();
  }

  function debugLogSelection(sampleCount = 8) {
    if (!debugPipeline || !DEBUG_SELECTION) return;
    // Dispatch sampleCount threads — each logs one point
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
    runLassoSelection,
    runMarqueeSelection,
    selectPoint,
    clearSelection,
    debugLogSelection,
    pipComputeFn,
    aabbComputeFn,
    destroy() {
      stagingBuffer.destroy();
    },
  };
}

export type SelectionEngine = ReturnType<typeof createSelectionEngine>;
