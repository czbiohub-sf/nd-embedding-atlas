import { tgpu } from "typegpu";
import * as d from "typegpu/data";
import type { TgpuRoot } from "../types";
import type { ScatterBuffers, ScatterUniforms } from "./buffers";

const LEGACY_MODE = typeof location !== "undefined" && new URLSearchParams(location.search).has("scatter-legacy");

/**
 * GPU viewport culling via compute shader.
 *
 * For each point, checks if `(pos + pan) * zoom` is within NDC [-1, 1]
 * (plus a small margin for point quads). Writes a visibility flag (0 or 1)
 * to a buffer that the vertex shader uses to collapse invisible points.
 *
 * Default path (0.11+): guarded compute pipeline, one thread per point.
 * Legacy path (`?scatter-legacy=1`): BATCH=4 unroll + manual bounds guard,
 * preserved for rollback during the 0.11 transition.
 */
export function createCullingEngine(
  root: TgpuRoot,
  _device: GPUDevice,
  buffers: ScatterBuffers,
  uniforms: ScatterUniforms,
  numPoints: number,
  wgSize: 64 | 256 = 256,
) {
  // Visibility buffer: 1 = visible, 0 = culled
  const visibilityBuffer = root.createBuffer(d.arrayOf(d.u32, numPoints)).$usage("storage", "vertex");
  const visibilityLayout = tgpu.vertexLayout((n: number) => d.arrayOf(d.u32, n), "instance");

  const posReadonly = buffers.posBuffer.as("readonly");
  const visMutable = visibilityBuffer.as("mutable");
  const { viewUniform } = uniforms;

  const margin = 0.05;

  let dispatchFn: () => void;
  // Only populated in legacy mode — guarded pipelines don't expose a shell for tgpu.resolve().
  let legacyComputeFn: unknown = null;

  if (LEGACY_MODE) {
    const BATCH = [0, 1, 2, 3] as const;

    const legacyFn = tgpu
      .computeFn({
        workgroupSize: [wgSize],
        in: { gid: d.builtin.globalInvocationId },
      })((input) => {
        "use gpu";
        const base = input.gid.x * BATCH.length;
        const view = viewUniform.$;
        const xb = (1.0 + margin) * view.w;
        for (const k of tgpu.unroll(BATCH)) {
          const idx = base + k;
          if (idx < numPoints) {
            const pos = posReadonly.$[idx];
            const sx = (pos.x + view.x) * view.z;
            const sy = (pos.y + view.y) * view.z;
            if (sx >= -xb && sx <= xb && sy >= -(1.0 + margin) && sy <= 1.0 + margin) {
              visMutable.$[idx] = 1;
            } else {
              visMutable.$[idx] = 0;
            }
          }
        }
      })
      .$uses({ posReadonly, visMutable, viewUniform });

    const pipeline = root.createComputePipeline({ compute: legacyFn });
    const workgroups = Math.ceil(numPoints / (wgSize * BATCH.length));
    legacyComputeFn = legacyFn;
    dispatchFn = () => pipeline.dispatchWorkgroups(workgroups);
  } else {
    const pipeline = root.createGuardedComputePipeline((x: number) => {
      "use gpu";
      const idx = x;
      const pos = posReadonly.$[idx];
      const view = viewUniform.$;
      const xb = (1.0 + margin) * view.w;
      const sx = (pos.x + view.x) * view.z;
      const sy = (pos.y + view.y) * view.z;
      if (sx >= -xb && sx <= xb && sy >= -(1.0 + margin) && sy <= 1.0 + margin) {
        visMutable.$[idx] = 1;
      } else {
        visMutable.$[idx] = 0;
      }
    });
    dispatchFn = () => pipeline.dispatchThreads(numPoints);
  }

  let lastViewVersion = -1;

  function dispatchCulling(viewVersion = 0) {
    if (viewVersion === lastViewVersion) return;
    lastViewVersion = viewVersion;
    dispatchFn();
  }

  return {
    visibilityBuffer,
    visibilityLayout,
    dispatchCulling,
    legacyComputeFn,
    destroy() {
      // TypeGPU buffers are cleaned up by root.destroy()
    },
  };
}

export type CullingEngine = ReturnType<typeof createCullingEngine>;
