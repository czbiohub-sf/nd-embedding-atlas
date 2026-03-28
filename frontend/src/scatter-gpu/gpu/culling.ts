import tgpu from "typegpu";
import * as d from "typegpu/data";
import type { TgpuRoot } from "../types";
import type { ScatterBuffers, ScatterUniforms } from "./buffers";

/**
 * GPU viewport culling via compute shader.
 *
 * For each point, checks if `(pos + pan) * zoom` is within NDC [-1, 1]
 * (plus a small margin for point quads). Writes a visibility flag (0 or 1)
 * to a buffer that the vertex shader uses to collapse invisible points.
 *
 * Batch size 4: each thread tests 4 consecutive points, reducing dispatch
 * overhead. Uses tgpu.unroll for compile-time loop unrolling instead of
 * manual WGSL string template building.
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

  const posReadonly = buffers.posBuffer.as("readonly");
  const visMutable  = visibilityBuffer.as("mutable");
  const { viewUniform } = uniforms;

  // Compile-time constant — tgpu.unroll expands this to 4 explicit blocks
  const BATCH = [0, 1, 2, 3] as const;

  const cullComputeFn = tgpu["~unstable"].computeFn({
    workgroupSize: [256],
    in: { gid: d.builtin.globalInvocationId },
  })((input) => {
    "use gpu";
    const base = input.gid.x * BATCH.length;
    const view = viewUniform.value;
    const m = 0.05;
    const xb = (1.0 + m) * view.w;
    for (const k of tgpu.unroll(BATCH)) {
      const idx = base + k;
      if (idx < numPoints) {
        const pos = posReadonly.value[idx];
        const sx = (pos.x + view.x) * view.z;
        const sy = (pos.y + view.y) * view.z;
        if (sx >= -xb && sx <= xb && sy >= -(1.0 + m) && sy <= 1.0 + m) {
          visMutable.value[idx] = 1;
        } else {
          visMutable.value[idx] = 0;
        }
      }
    }
  }).$uses({ posReadonly, visMutable, viewUniform });

  const cullPipeline = root["~unstable"]
    .withCompute(cullComputeFn)
    .createPipeline();

  const workgroups = Math.ceil(numPoints / (256 * BATCH.length));
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
