import tgpu from "typegpu";
import * as d from "typegpu/data";
import * as std from "typegpu/std";
import { computeFn } from "./tgpu-compat";
import type { TgpuRoot } from "../types";
import type { ScatterBuffers, ScatterUniforms } from "./buffers";

// Layer bit constants
export const LAYER_LASSO      = 0b0001;
export const LAYER_EXTERNAL   = 0b0010;
export const LAYER_ISOLATION  = 0b0100;
export const LAYER_ANNOTATION = 0b1000;

export function createCompositor(
  root: TgpuRoot,
  device: GPUDevice,
  buffers: ScatterBuffers,
  uniforms: ScatterUniforms,
  numPoints: number,
  wgSize: 64 | 256 = 64,
) {
  void device; // kept for API symmetry / future use

  // 4 layer buffers — all u32[numPoints], storage usage
  const lassoBuffer      = root.createBuffer(d.arrayOf(d.u32, numPoints)).$usage("storage");
  const externalBuffer   = root.createBuffer(d.arrayOf(d.u32, numPoints)).$usage("storage");
  const isolationBuffer  = root.createBuffer(d.arrayOf(d.u32, numPoints)).$usage("storage");
  const annotationBuffer = root.createBuffer(d.arrayOf(d.u32, numPoints)).$usage("storage");

  let isDirty       = false;
  let layerActiveBits = 0;

  // Buffer views used by the compositor shader
  const lassoReadonly      = lassoBuffer.as("readonly");
  const externalReadonly   = externalBuffer.as("readonly");
  const isolationReadonly  = isolationBuffer.as("readonly");
  const annotationReadonly = annotationBuffer.as("readonly");
  const { selectedBuffer }  = buffers;
  const selectedMutable    = selectedBuffer.as("mutable");
  const { selectionModeUniform } = uniforms;

  // Uniform carrying the layer active bitmask into the GPU shader
  const layerBitsUniform = root.createUniform(d.u32, 0);

  // ── Compositor compute kernel ──────────────────────────────────────────────
  // Two-tier AND/OR semantics:
  //   isolation tier : isolationBuffer (active only when LAYER_ISOLATION bit set)
  //   selection tier : lasso | external (OR; active when either bit set)
  //   annotation     : reserved for future use (ignored in current composite)
  //   final          : intersection(isolation_tier, selection_tier) with identity fallback
  //     - if neither tier active → pass-all (1)
  //     - if only isolation active → isoPass
  //     - if only selection active → selPass
  //     - if both active → isoPass & selPass
  const COMP_BATCH = [0, 1] as const;

  const compositorFn = computeFn({
    workgroupSize: [wgSize],
    in: { gid: d.builtin.globalInvocationId },
  })((input) => {
    "use gpu";
    const base    = input.gid.x * COMP_BATCH.length;
    const layerBits = layerBitsUniform.value;
    for (const k of tgpu.unroll(COMP_BATCH)) {
      const idx = base + k;
      if (idx < numPoints) {
        const iso = isolationReadonly.value[idx];
        const lasso = lassoReadonly.value[idx];
        const ext   = externalReadonly.value[idx];

        // Tier flags derived from bitmask
        const hasIso = (layerBits & 4) != 0;   // LAYER_ISOLATION
        const hasSel = ((layerBits & 1) | (layerBits & 2)) != 0; // lasso | external

        // isoPass: if isolation tier active, point must be in isolation mask
        const isoPass = std.select(1, iso, hasIso);
        // selPass: if selection tier active, point must be in lasso OR external
        const selPass = std.select(1, lasso | ext, hasSel);

        selectedMutable.value[idx] = isoPass & selPass;
      }
    }
  }).$uses({
    layerBitsUniform,
    lassoReadonly,
    externalReadonly,
    isolationReadonly,
    annotationReadonly,
    selectedMutable,
  });

  const compositorPipeline = root["~unstable"].withCompute(compositorFn).createPipeline();
  const workgroups = Math.ceil(numPoints / (wgSize * COMP_BATCH.length));

  function markDirty(layerBit: number, isActive: boolean): void {
    isDirty = true;
    if (isActive) layerActiveBits |= layerBit;
    else          layerActiveBits &= ~layerBit;
  }

  function dispatchIfDirty(): void {
    if (!isDirty) return;
    isDirty = false;
    layerBitsUniform.write(layerActiveBits);
    compositorPipeline.dispatchWorkgroups(workgroups);
    selectionModeUniform.write(layerActiveBits !== 0 ? 1 : 0);
  }

  function destroy(): void {
    // TypeGPU manages buffer cleanup via root.destroy()
  }

  return {
    markDirty,
    dispatchIfDirty,
    get layerActiveBits() { return layerActiveBits; },
    // Expose layer buffers so selection engine can write into them
    lassoBuffer,
    externalBuffer,
    isolationBuffer,
    annotationBuffer,
    // Expose compute fn for WGSL debug dumps
    compositorFn,
    destroy,
  };
}

export type CompositorEngine = ReturnType<typeof createCompositor>;
