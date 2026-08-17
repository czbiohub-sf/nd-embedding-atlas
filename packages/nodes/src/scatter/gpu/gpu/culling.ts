import { tgpu } from "typegpu";
import * as d from "typegpu/data";
import type { TgpuRoot } from "../../gpu/types";
import type { ScatterBuffers, ScatterUniforms } from "./buffers";

/**
 * GPU viewport culling via compute shader.
 *
 * For each point, checks if `(pos + pan) * zoom` is within NDC [-1, 1]
 * (plus a small margin for point quads). Writes a visibility flag (0 or 1)
 * to a buffer that the vertex shader uses to collapse invisible points.
 */
export function createCullingEngine(
  root: TgpuRoot,
  _device: GPUDevice,
  buffers: ScatterBuffers,
  uniforms: ScatterUniforms,
  numPoints: number,
  _wgSize: 64 | 256 = 256,
) {
  const visibilityBuffer = root.createBuffer(d.arrayOf(d.u32, numPoints)).$usage("storage", "vertex");
  const visibilityLayout = tgpu.vertexLayout((n: number) => d.arrayOf(d.u32, n), "instance");

  const posReadonly = buffers.posBuffer.as("readonly");
  const predicateFilterReadonly = buffers.predicateFilterBuffer.as("readonly");
  const visMutable = visibilityBuffer.as("mutable");
  const { viewUniform, predicateFilterActiveUniform } = uniforms;

  const margin = 0.05;

  const pipeline = root.createGuardedComputePipeline((x: number) => {
    "use gpu";
    const idx = x;
    const pos = posReadonly.$[idx];
    const view = viewUniform.$;
    const xb = (1.0 + margin) * view.w;
    const yb = 1.0 + margin;
    const sx = (pos.x + view.x) * view.z;
    const sy = (pos.y + view.y) * view.z;
    const passesPredicate = predicateFilterActiveUniform.$ === 0 || predicateFilterReadonly.$[idx] === 1;
    if (passesPredicate && sx >= -xb && sx <= xb && sy >= -yb && sy <= yb) {
      visMutable.$[idx] = 1;
    } else {
      visMutable.$[idx] = 0;
    }
  });

  let lastViewVersion = -1;

  function dispatchCulling(viewVersion = 0, encoder?: GPUCommandEncoder) {
    if (viewVersion === lastViewVersion) return;
    lastViewVersion = viewVersion;
    if (encoder) {
      pipeline.sizeUniform.write(d.vec3u(numPoints, 1, 1));
      pipeline.pipeline.with(encoder).dispatchWorkgroups(Math.ceil(numPoints / 256));
    } else pipeline.dispatchThreads(numPoints);
  }

  return {
    visibilityBuffer,
    visibilityLayout,
    dispatchCulling,
    invalidate() {
      lastViewVersion = -1;
    },
    destroy() {
      // TypeGPU buffers are cleaned up by root.destroy()
    },
  };
}

export type CullingEngine = ReturnType<typeof createCullingEngine>;
