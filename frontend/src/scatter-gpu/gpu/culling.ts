import tgpu from "typegpu";
import * as d from "typegpu/data";
import { computeFn } from "./tgpu-compat";
import type { TgpuRoot } from "../types";
import type { ScatterBuffers, ScatterUniforms } from "./buffers";

/**
 * GPU viewport culling via compute shader.
 *
 * For each point, checks if `(pos + pan) * zoom` is within NDC [-1, 1]
 * (plus a small margin for point quads). Writes a visibility flag (0 or 1)
 * to a buffer that the vertex shader uses to collapse invisible points.
 *
 * This avoids buffer reordering — the vertex shader simply scales
 * invisible point quads to zero area.
 */
export function createCullingEngine(
  root: TgpuRoot,
  _device: GPUDevice,
  buffers: ScatterBuffers,
  uniforms: ScatterUniforms,
  numPoints: number,
) {
  // Visibility buffer: 1 = visible, 0 = culled
  const visibilityBuffer = root
    .createBuffer(d.arrayOf(d.u32, numPoints))
    .$usage("storage", "vertex");

  const visibilityLayout = tgpu.vertexLayout(
    (n: number) => d.arrayOf(d.u32, n),
    "instance",
  );

  // Compute shader reads positions + view uniform, writes visibility
  const posReadonly = buffers.posBuffer.as("readonly");
  const visMutable = visibilityBuffer.as("mutable");

  const batchSize = 4;
  let batchBody = "";
  for (let k = 0; k < batchSize; k++) {
    batchBody += `
    {
      let idx = base + ${k}u;
      if (idx < ${numPoints}u) {
        let pos = positions[idx];
        let sx = (pos.x + view.x) * view.z;
        let sy = (pos.y + view.y) * view.z;
        let m = 0.05;
        let xBound = (1.0 + m) * view.w;
        visibility[idx] = select(0u, 1u, sx >= -xBound && sx <= xBound && sy >= -(1.0 + m) && sy <= (1.0 + m));
      }
    }`;
  }

  const cullComputeFn = computeFn({
    workgroupSize: [256],
    in: { gid: d.builtin.globalInvocationId },
  })`{
    let base = in.gid.x * ${batchSize}u;
    ${batchBody}
  }`.$uses({
    positions: posReadonly,
    visibility: visMutable,
    view: uniforms.viewUniform,
  });

  const cullPipeline = root["~unstable"]
    .withCompute(cullComputeFn)
    .createPipeline();

  const workgroups = Math.ceil(numPoints / (256 * batchSize));
  let lastViewVersion = -1;

  function dispatchCulling(viewVersion = 0) {
    if (viewVersion === lastViewVersion) return;
    lastViewVersion = viewVersion;
    cullPipeline.dispatchWorkgroups(workgroups);
  }

  return {
    visibilityBuffer,
    visibilityLayout,
    dispatchCulling,
    cullComputeFn,
    destroy() {
      // TypeGPU buffers are cleaned up by root.destroy()
    },
  };
}

export type CullingEngine = ReturnType<typeof createCullingEngine>;
