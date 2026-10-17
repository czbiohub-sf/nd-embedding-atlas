import { tgpu } from "typegpu";
import * as d from "typegpu/data";
import * as std from "typegpu/std";
import { MAX_POLYGON_VERTS } from "../../gpu/constants";
import type { TgpuRoot } from "../../gpu/types";
import type { GpuPointIndex } from "../../contracts";
import { simplifyPath } from "../../gpu/utils/geometry";
import { latestOnly } from "../../gpu/utils/latest-only";
import type { ScatterBuffers, ScatterUniforms } from "./buffers";
import { type CompositorEngine, LAYER_EXTERNAL, LAYER_HIGHLIGHT, LAYER_ISOLATION, LAYER_LASSO } from "./compositor";

const DEBUG_SELECTION = typeof location !== "undefined" && new URLSearchParams(location.search).has("debug-selection");

export function createSelectionEngine(
  root: TgpuRoot,
  device: GPUDevice,
  buffers: ScatterBuffers,
  uniforms: ScatterUniforms,
  numPoints: number,
  compositor: CompositorEngine,
  /** Count on every drag readback; the lasso bit layer too on the final (pointer-up) one. */
  onBrushSelectionChange: (count: number | null, bits?: Uint32Array<ArrayBuffer>) => void,
) {
  const { posBuffer, selectedBuffer } = buffers;
  const numWords = Math.ceil(numPoints / 32);

  const polygonBuffer = root.createBuffer(d.arrayOf(d.vec2f, MAX_POLYGON_VERTS)).$usage("storage");
  // i32 (not u32): `std.range(N)` yields i32 indices in the pip kernel, and
  // WGSL is strict about mixed i32/u32 comparisons. Value is always small
  // (≤ MAX_POLYGON_VERTS = 512) so signedness has no semantic effect.
  const polygonCountUniform = root.createUniform(d.i32, 0);
  // xMin, yMin, xMax, yMax of the marquee; `shapeUniform` 1 = marquee, 0 = lasso polygon.
  const marqueeUniform = root.createUniform(d.vec4f, d.vec4f(0, 0, 0, 0));
  const shapeUniform = root.createUniform(d.u32, 0);
  // Popcount of the lasso bit layer, summed by the kernel: the only drag-time readback.
  const countBuffer = root.createBuffer(d.atomic(d.u32)).$usage("storage");

  const pointsReadonly = posBuffer.as("readonly");
  const selectedMutable = selectedBuffer.as("mutable");
  const polygonReadonly = polygonBuffer.as("readonly");
  // Category buffer reused by lasso/marquee shaders to skip points whose
  // category is in the disabled bitmask. (Same buffer the isolation kernel
  // reads further down: declaring the view once keeps both consumers in sync.)
  const lassoCategoryReadonly = buffers.categoryBuffer.as("readonly");
  const predicateReadonly = buffers.predicateBits.as("readonly");
  const { predicateFilterActiveUniform } = uniforms;
  // Bitmask of disabled categories: bit i set if category i is hidden via
  // the legend. Lasso/marquee kernels skip points whose category bit is set.
  const lassoDisabledMaskUniform = root.createUniform(d.u32, 0);
  const lassoBitsMutable = compositor.lassoBits.as("mutable");
  const countMutable = countBuffer.as("mutable");

  // ── PIP kernel ─────────────────────────────────────────────────────────

  // Point-in-polygon ray-crossing test. `j` rolls to the previous vertex
  // each iteration, forming the edge polygon[j] → polygon[i].
  //
  // Loop bound: std.range(numVerts) needs comptime bounds (TypeGPU 0.11+
  // rejects runtime uniforms there). Iterate the static MAX_POLYGON_VERTS
  // upper bound and early-out when i >= numVerts. numVerts must be i32 to
  // match std.range's i32 loop index under WGSL's strict type rules.
  const pipTest = tgpu.fn(
    [d.vec2f, d.i32],
    d.bool,
  )((pt, numVerts) => {
    "use gpu";
    let c = false;
    let j = numVerts - 1;
    for (const i of std.range(MAX_POLYGON_VERTS)) {
      if (i >= numVerts) break;
      // Array indexing: explicit u32 conversion silences TypeGPU's implicit-cast warning.
      const vi = polygonReadonly.$[d.u32(i)];
      const vj = polygonReadonly.$[d.u32(j)];
      const b = (vi.y <= pt.y && pt.y < vj.y) || (vj.y <= pt.y && pt.y < vi.y);
      if (b) {
        const xd = ((vj.x - vi.x) * (pt.y - vi.y)) / (vj.y - vi.y) + vi.x;
        if (pt.x < xd) c = !c;
      }
      j = i;
    }
    return c;
  });

  // One thread per 32-point word: writes the lasso bit layer and adds its popcount.
  const selectPipeline = root.createGuardedComputePipeline((w: number) => {
    "use gpu";
    let bits = d.u32(0);
    for (const b of std.range(32)) {
      const idx = w * 32 + d.u32(b);
      if (idx >= numPoints) break;
      const pt = pointsReadonly.$[idx];
      const isDisabled = ((lassoDisabledMaskUniform.$ >>> lassoCategoryReadonly.$[idx]) & 1) === 1;
      const isFiltered =
        predicateFilterActiveUniform.$ === 1 && ((predicateReadonly.$[idx >>> 5] >>> (idx & 31)) & 1) === 0;
      let inside = false;
      if (shapeUniform.$ === 1) {
        const r = marqueeUniform.$;
        inside = pt.x >= r.x && pt.x <= r.z && pt.y >= r.y && pt.y <= r.w;
      } else {
        inside = pipTest(pt, polygonCountUniform.$);
      }
      if (inside && !isFiltered && !isDisabled) bits = bits | (d.u32(1) << d.u32(b));
    }
    lassoBitsMutable.$[w] = bits;
    std.atomicAdd(countMutable.$, std.countOneBits(bits));
  });

  // ── Readback ───────────────────────────────────────────────────────────
  // Copies run on the queue after the dispatch that wrote the lasso layer, so
  // they always see the current selection. Drags read 4 bytes (the count);
  // pointer-up also reads the N/8-byte bit layer. A request made during a
  // readback is coalesced (latest wins), so the pointer-up one is never dropped.
  const countStaging = device.createBuffer({ size: 4, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
  const bitsStaging = device.createBuffer({
    size: numWords * 4,
    usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
  });
  // Bumped by clearSelection: drops readbacks requested before the clear.
  let generation = 0;
  const readback = latestOnly(async ({ final, gen }: { final: boolean; gen: number }) => {
    if (gen !== generation) return;
    const t0 = performance.now();
    const encoder = device.createCommandEncoder();
    encoder.copyBufferToBuffer(root.unwrap(countBuffer), 0, countStaging, 0, 4);
    if (final) encoder.copyBufferToBuffer(root.unwrap(compositor.lassoBits), 0, bitsStaging, 0, numWords * 4);
    device.queue.submit([encoder.finish()]);
    await Promise.all([countStaging.mapAsync(GPUMapMode.READ), final && bitsStaging.mapAsync(GPUMapMode.READ)]);
    const count = new Uint32Array(countStaging.getMappedRange())[0];
    countStaging.unmap();
    const bits = final ? new Uint32Array(bitsStaging.getMappedRange().slice(0)) : undefined;
    if (final) bitsStaging.unmap();
    if (gen !== generation) return;
    console.log(
      `${count.toLocaleString()} selected${final ? " (final)" : ""} (${(performance.now() - t0).toFixed(1)}ms)`,
    );
    onBrushSelectionChange(count, bits);
  });

  function select(final: boolean) {
    device.queue.writeBuffer(root.unwrap(countBuffer), 0, new Uint32Array(1));
    selectPipeline.dispatchThreads(numWords);
    compositor.markDirty(LAYER_LASSO, true);
    debugLogSelection();
    readback({ final, gen: generation });
  }

  function runLassoSelection(polygon: [number, number][], final: boolean) {
    if (polygon.length < 3) return;
    const simplified = simplifyPath(polygon, 0.001);
    const vertCount = Math.min(simplified.length, MAX_POLYGON_VERTS);
    const polyData = simplified.slice(0, vertCount).map(([x, y]) => d.vec2f(x, y));
    while (polyData.length < MAX_POLYGON_VERTS) polyData.push(d.vec2f(0, 0));
    polygonBuffer.write(polyData);
    polygonCountUniform.write(vertCount);
    shapeUniform.write(0);
    select(final);
  }

  function runMarqueeSelection(rect: { xMin: number; yMin: number; xMax: number; yMax: number }, final: boolean) {
    marqueeUniform.write(d.vec4f(rect.xMin, rect.yMin, rect.xMax, rect.yMax));
    shapeUniform.write(1);
    select(final);
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

  // ── Composable highlight ────────────────────────────────────────────────
  // Two independent sources merged into highlightBuffer: clicked point + trajectory points.
  // Same pattern as recomposeIsolation: each source owns its state, recomposeHighlight merges.
  const highlightMask = new Uint32Array(numPoints); // pre-allocated scratch
  let clickedPointIndex: GpuPointIndex | null = null;
  let trajectoryHighlightIndices: GpuPointIndex[] = [];

  function recomposeHighlight() {
    const hasClick = clickedPointIndex != null;
    const hasTrajectory = trajectoryHighlightIndices.length > 0;
    if (!hasClick && !hasTrajectory) {
      const encoder = device.createCommandEncoder();
      encoder.clearBuffer(root.unwrap(compositor.highlightBuffer));
      device.queue.submit([encoder.finish()]);
      compositor.markDirty(LAYER_HIGHLIGHT, false);
      return;
    }
    highlightMask.fill(0);
    // Trajectory points get 1 (full bright), clicked point gets 2 (outline ring)
    for (const idx of trajectoryHighlightIndices) {
      if (idx >= 0 && idx < numPoints) highlightMask[idx] = 1;
    }
    if (clickedPointIndex != null) highlightMask[clickedPointIndex] = 2;
    compositor.highlightBuffer.write(highlightMask);
    compositor.markDirty(LAYER_HIGHLIGHT, true);
  }

  function selectPoint(pointIndex: GpuPointIndex) {
    clickedPointIndex = pointIndex;
    recomposeHighlight();
  }

  function setHighlightPoints(pointIndices: GpuPointIndex[]) {
    trajectoryHighlightIndices = pointIndices;
    recomposeHighlight();
  }

  function clearHighlight() {
    clickedPointIndex = null;
    trajectoryHighlightIndices = [];
    recomposeHighlight();
  }

  // Pre-allocated mask: reused on every external selection update to avoid
  // O(n) heap allocation per sync event (critical for 455K+ point datasets).
  const externalSelectionMask = new Uint32Array(numPoints);

  function setSelectedPoints(pointIndices: GpuPointIndex[]) {
    externalSelectionMask.fill(0);
    for (const idx of pointIndices) {
      if (idx >= 0 && idx < numPoints) externalSelectionMask[idx] = 1;
    }
    compositor.externalBuffer.write(externalSelectionMask);
    compositor.markDirty(LAYER_EXTERNAL, true);
  }

  function clearSelectionExternal() {
    externalSelectionMask.fill(0);
    compositor.externalBuffer.write(externalSelectionMask);
    compositor.markDirty(LAYER_EXTERNAL, false);
    // Do not call onBrushSelectionChange here: republishing the external clear would
    // notify peers, which would clear and republish in a loop.
    // Status bar is updated via the separate onExternalClear callback in orchestrator.
  }

  // ── Composable isolation masks (GPU-composed) ───────────────────────────
  // Three features independently own their source: category (bitmask over the
  // already-on-GPU categoryBuffer), trajectory (u32[N] uploaded), continuous
  // (u32[N] uploaded). A guarded compute kernel composes them on the GPU
  // into compositor.isolationBuffer. CPU keeps the raw trajectory/continuous
  // masks + catBitmask + cachedCategoryIndices so isPointVisible can compute
  // per-point visibility synchronously without a GPU readback.

  const trajectoryMaskBuffer = root.createBuffer(d.arrayOf(d.u32, numPoints)).$usage("storage");
  const continuousMaskBuffer = root.createBuffer(d.arrayOf(d.u32, numPoints)).$usage("storage");

  // activeFlags bit 0=category, 1=trajectory, 2=continuous. catBitmask: bit i set
  // if category index i is isolated (supports ≤32 categories, matches our cap).
  const IsolationConfig = d.struct({ activeFlags: d.u32, catBitmask: d.u32 });
  const isolationConfigUniform = root.createUniform(IsolationConfig, { activeFlags: 0, catBitmask: 0 });

  const categoryReadonly = buffers.categoryBuffer.as("readonly");
  const trajectoryReadonly = trajectoryMaskBuffer.as("readonly");
  const continuousReadonly = continuousMaskBuffer.as("readonly");
  const isolationMutable = compositor.isolationBuffer.as("mutable");

  const composeIsolationPipeline = root.createGuardedComputePipeline((x: number) => {
    "use gpu";
    const idx = x;
    const cfg = isolationConfigUniform.$;
    const catActive = (cfg.activeFlags & 1) !== 0;
    const trajActive = (cfg.activeFlags & 2) !== 0;
    const contActive = (cfg.activeFlags & 4) !== 0;

    const catIdx = categoryReadonly.$[idx];
    const catBit = (cfg.catBitmask >> catIdx) & 1;
    const cat = std.select(1, catBit, catActive);
    const traj = std.select(0, trajectoryReadonly.$[idx], trajActive);
    const cont = std.select(1, continuousReadonly.$[idx], contActive);

    isolationMutable.$[idx] = traj | (cat & cont);
  });

  // CPU mirror state: lets isPointVisible answer O(1) without GPU readback.
  const trajectoryMaskCpu = new Uint32Array(numPoints);
  const continuousMaskCpu = new Uint32Array(numPoints);
  let catBitmask = 0;
  let cachedCategoryIndices: Uint8Array | null = null;
  let categoryActive = false;
  let trajectoryActive = false;
  let continuousActive = false;
  const predicateBitsCpu = new Uint32Array(numWords);
  let predicateFilterActive = false;
  // Disabled-category bitmask: CPU-only (GPU renders alpha=0 via color override,
  // so no shader plumbing needed). Used to gate the click handler so points in a
  // disabled category aren't selectable.
  let disabledCatBitmask = 0;

  function writeIsolationConfig() {
    const activeFlags = (categoryActive ? 1 : 0) | (trajectoryActive ? 2 : 0) | (continuousActive ? 4 : 0);
    isolationConfigUniform.write({ activeFlags, catBitmask });
  }

  /**
   * Dispatch the GPU compose kernel and flag the isolation layer active.
   * If no source is active, clear the isolation buffer and deactivate the layer.
   */
  function recomposeIsolation() {
    const anyActive = categoryActive || trajectoryActive || continuousActive;
    if (!anyActive) {
      const encoder = device.createCommandEncoder();
      encoder.clearBuffer(root.unwrap(compositor.isolationBuffer));
      device.queue.submit([encoder.finish()]);
      compositor.markDirty(LAYER_ISOLATION, false);
      return;
    }
    writeIsolationConfig();
    composeIsolationPipeline.dispatchThreads(numPoints);
    compositor.markDirty(LAYER_ISOLATION, true);
  }

  function setCategoryIsolation(isolatedSet: Set<number>, categoryIndices: Uint8Array) {
    if (isolatedSet.size === 0) {
      clearCategoryIsolation();
      return;
    }
    let bitmask = 0 >>> 0;
    for (const cat of isolatedSet) bitmask = (bitmask | (1 << cat)) >>> 0;
    catBitmask = bitmask;
    cachedCategoryIndices = categoryIndices;
    categoryActive = true;
    recomposeIsolation();
  }

  function clearCategoryIsolation() {
    catBitmask = 0;
    categoryActive = false;
    recomposeIsolation();
  }

  /**
   * Mark categories as disabled: points in any disabled category are skipped
   * by:
   *   - `isPointVisible` (CPU) → no point-click selection.
   *   - the lasso/marquee compute kernels (via `lassoDisabledMaskUniform`)
   *     → no rectangle/polygon selection.
   *
   * GPU rendering already hides them via legend's color-alpha override,
   * so the compositor isolation kernel doesn't need this signal.
   */
  function setCategoryDisabled(disabledSet: Set<number>, categoryIndices: Uint8Array) {
    let bitmask = 0 >>> 0;
    for (const cat of disabledSet) bitmask = (bitmask | (1 << cat)) >>> 0;
    disabledCatBitmask = bitmask;
    cachedCategoryIndices = categoryIndices;
    lassoDisabledMaskUniform.write(bitmask);
  }

  function clearCategoryDisabled() {
    disabledCatBitmask = 0;
    lassoDisabledMaskUniform.write(0);
  }

  /** `bits` may be shorter than the layer: missing trailing words hide their points. */
  function setPredicateFilter(bits: Uint32Array) {
    predicateBitsCpu.fill(0);
    predicateBitsCpu.set(bits.subarray(0, numWords));
    buffers.predicateBits.write(predicateBitsCpu);
    predicateFilterActive = true;
    predicateFilterActiveUniform.write(1);
  }

  function clearPredicateFilter() {
    predicateFilterActive = false;
    predicateFilterActiveUniform.write(0);
  }

  function setTrajectoryIsolation(mask: Uint32Array) {
    trajectoryMaskCpu.set(mask);
    trajectoryMaskBuffer.write(trajectoryMaskCpu);
    trajectoryActive = true;
    recomposeIsolation();
  }

  function clearTrajectoryIsolation() {
    trajectoryMaskCpu.fill(0);
    trajectoryActive = false;
    recomposeIsolation();
  }

  function setContinuousIsolation(mask: Uint32Array) {
    continuousMaskCpu.set(mask);
    continuousMaskBuffer.write(continuousMaskCpu);
    continuousActive = true;
    recomposeIsolation();
  }

  function clearContinuousIsolation() {
    continuousMaskCpu.fill(0);
    continuousActive = false;
    recomposeIsolation();
  }

  /** Re-upload all CPU masks to GPU after GPU reinit (positionKey change). */
  function rehydrateIsolation() {
    recomposeIsolation();
  }

  /** Check if a point is visible under current isolation (for click filtering). */
  function isPointVisible(pointIndex: GpuPointIndex): boolean {
    if (predicateFilterActive && ((predicateBitsCpu[pointIndex >> 5] >>> (pointIndex & 31)) & 1) === 0) return false;
    // Disabled-category gate: a point in a disabled category is never visible,
    // regardless of isolation/trajectory/continuous state. Matches the legend's
    // semantic that disabled = hidden everywhere (render and clicks).
    if (disabledCatBitmask !== 0) {
      const catIdx = cachedCategoryIndices?.[pointIndex] ?? 0;
      if ((disabledCatBitmask >>> catIdx) & 1) return false;
    }
    if (!categoryActive && !trajectoryActive && !continuousActive) return true;
    const catIdx = cachedCategoryIndices?.[pointIndex] ?? 0;
    const cat = categoryActive ? (catBitmask >>> catIdx) & 1 : 1;
    const traj = trajectoryActive ? trajectoryMaskCpu[pointIndex] : 0;
    const cont = continuousActive ? continuousMaskCpu[pointIndex] : 1;
    return (traj | (cat & cont)) === 1;
  }

  return {
    runLassoSelection,
    runMarqueeSelection,
    selectPoint,
    clearSelection() {
      generation++;
      const encoder = device.createCommandEncoder();
      encoder.clearBuffer(root.unwrap(compositor.lassoBits));
      device.queue.submit([encoder.finish()]);
      compositor.markDirty(LAYER_LASSO, false);
      onBrushSelectionChange(null);
    },
    clearHighlight,
    setHighlightPoints,
    isPointVisible,
    setSelectedPoints,
    clearSelectionExternal,
    setCategoryIsolation,
    clearCategoryIsolation,
    setCategoryDisabled,
    clearCategoryDisabled,
    setPredicateFilter,
    clearPredicateFilter,
    setTrajectoryIsolation,
    clearTrajectoryIsolation,
    setContinuousIsolation,
    clearContinuousIsolation,
    rehydrateIsolation,
    debugLogSelection,
    destroy() {
      generation++;
      countStaging.destroy();
      bitsStaging.destroy();
    },
  };
}

export type SelectionEngine = ReturnType<typeof createSelectionEngine>;
