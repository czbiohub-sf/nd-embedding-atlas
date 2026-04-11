import { tgpu } from "typegpu";
import * as d from "typegpu/data";
import * as std from "typegpu/std";
import type { TgpuRoot } from "../types";
import type { ScatterBuffers, ScatterUniforms } from "./buffers";

// TypeGPU manages buffer cleanup via root.destroy()
function destroy(): void {}

// Layer bit constants
export const LAYER_LASSO = 0b00001;
export const LAYER_EXTERNAL = 0b00010;
export const LAYER_ISOLATION = 0b00100;
export const LAYER_ANNOTATION = 0b01000;
export const LAYER_HIGHLIGHT = 0b10000;

export function createCompositor(
  root: TgpuRoot,
  device: GPUDevice,
  buffers: ScatterBuffers,
  uniforms: ScatterUniforms,
  numPoints: number,
  wgSize: 64 | 256 = 64,
) {
  void device; // kept for API symmetry / future use

  // 5 layer buffers — all u32[numPoints], storage usage
  const lassoBuffer = root.createBuffer(d.arrayOf(d.u32, numPoints)).$usage("storage");
  const externalBuffer = root.createBuffer(d.arrayOf(d.u32, numPoints)).$usage("storage");
  const isolationBuffer = root.createBuffer(d.arrayOf(d.u32, numPoints)).$usage("storage");
  const annotationBuffer = root.createBuffer(d.arrayOf(d.u32, numPoints)).$usage("storage");
  const highlightBuffer = root.createBuffer(d.arrayOf(d.u32, numPoints)).$usage("storage");

  let isDirty = false;
  let layerActiveBits = 0;

  // Buffer views used by the compositor shader
  const lassoReadonly = lassoBuffer.as("readonly");
  const externalReadonly = externalBuffer.as("readonly");
  const isolationReadonly = isolationBuffer.as("readonly");
  const annotationReadonly = annotationBuffer.as("readonly");
  const highlightReadonly = highlightBuffer.as("readonly");
  const { selectedBuffer } = buffers;
  const selectedMutable = selectedBuffer.as("mutable");
  const { selectionModeUniform } = uniforms;

  // Uniform carrying the layer active bitmask into the GPU shader
  const layerBitsUniform = root.createUniform(d.u32, 0);

  // ── Compositor compute kernel ──────────────────────────────────────────────
  // Three-tier composition (materialized view — selectedBuffer is never written directly):
  //
  //   highlight tier : highlightBuffer (point click — always wins)
  //   isolation tier : isolationBuffer (category + trajectory + continuous masks)
  //   selection tier : lasso | external (lasso/marquee OR cross-panel sync)
  //
  //   final = highlight | (isoPass & selPass)
  //
  //   - Highlighted points are always fully bright (never dimmed by filters)
  //   - Isolation and selection tiers intersect normally
  //   - If no tiers active → pass-all (1)
  const COMP_BATCH = [0, 1, 2, 3] as const;

  const compositorFn = tgpu
    .computeFn({
      workgroupSize: [wgSize],
      in: { gid: d.builtin.globalInvocationId },
    })((input) => {
      "use gpu";
      const base = input.gid.x * COMP_BATCH.length;
      const layerBits = layerBitsUniform.$;
      for (const k of tgpu.unroll(COMP_BATCH)) {
        const idx = base + k;
        if (idx < numPoints) {
          const iso = isolationReadonly.$[idx];
          const lasso = lassoReadonly.$[idx];
          const ext = externalReadonly.$[idx];
          const hi = highlightReadonly.$[idx];

          // Tier flags derived from bitmask
          const hasHi = (layerBits & 16) !== 0; // LAYER_HIGHLIGHT
          const hasIso = (layerBits & 4) !== 0; // LAYER_ISOLATION
          const hasSel = ((layerBits & 1) | (layerBits & 2)) !== 0; // lasso | external

          // Each tier: if active, use buffer value; if inactive, identity
          const hiVal = std.select(0, hi, hasHi); // 0=none, 1=trajectory, 2=clicked
          const isoPass = std.select(1, iso, hasIso);
          const selPass = std.select(1, lasso | ext, hasSel);

          // Four-tier brightness:
          //   3 = clicked point (outline ring + full bright)
          //   2 = full bright (trajectory, or passes filters with no highlight)
          //   1 = moderate dim (passes filters but not highlighted)
          //   0 = heavy dim (filtered out)
          const filterPass = isoPass & selPass;
          const hasFilters = hasIso || hasSel;
          const useModerate = hasHi && hasFilters;
          // Without moderate: filterPass * 2 → 0 or 2, but clicked point always gets 3
          const binary = std.select(filterPass * 2, 3, hiVal >= 2);
          // With moderate: clicked→3, trajectory→2, filterPass→1, else→0
          const tiered = std.select(filterPass, hiVal + 1, hiVal !== 0);
          selectedMutable.$[idx] = std.select(binary, tiered, useModerate);
        }
      }
    })
    .$uses({
      layerBitsUniform,
      lassoReadonly,
      externalReadonly,
      isolationReadonly,
      annotationReadonly,
      highlightReadonly,
      selectedMutable,
    });

  const compositorPipeline = root.createComputePipeline({ compute: compositorFn });
  const workgroups = Math.ceil(numPoints / (wgSize * COMP_BATCH.length));

  function markDirty(layerBit: number, isActive: boolean): void {
    isDirty = true;
    if (isActive) layerActiveBits |= layerBit;
    else layerActiveBits &= ~layerBit;
  }

  function dispatchIfDirty(): void {
    if (!isDirty) return;
    isDirty = false;
    layerBitsUniform.write(layerActiveBits);
    compositorPipeline.dispatchWorkgroups(workgroups);
    selectionModeUniform.write(layerActiveBits !== 0 ? 1 : 0);
  }

  return {
    markDirty,
    dispatchIfDirty,
    get layerActiveBits() {
      return layerActiveBits;
    },
    // Expose layer buffers so selection engine can write into them
    lassoBuffer,
    externalBuffer,
    isolationBuffer,
    annotationBuffer,
    highlightBuffer,
    // Expose compute fn for WGSL debug dumps
    compositorFn,
    destroy,
  };
}

export type CompositorEngine = ReturnType<typeof createCompositor>;
