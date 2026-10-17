import { tgpu } from "typegpu";
import * as d from "typegpu/data";
import * as std from "typegpu/std";
import type { TgpuRoot } from "../../gpu/types";
import { latestOnly } from "../../gpu/utils/latest-only";
import { Bit, LAYERS, type Scene } from "./scene";

/** Paints the selection shape (white) into the mask, in overlay CSS pixels. */
export type PaintShape = (ctx: OffscreenCanvasRenderingContext2D) => void;

export interface SelectionEngine {
  /**
   * Select every visible point whose projection falls inside the painted shape
   * (`front`: only the nearest dense structure under it): writes the lasso bit
   * layer and reports the count; `final` (pointer-up) also reports the
   * selection as a row-order bitmask (N/32 words). The frame uniform must be current.
   */
  run(paint: PaintShape, width: number, height: number, final: boolean, front: boolean): void;
  /** Drop readbacks requested before now. */
  clear(): void;
  destroy(): void;
}

/** Front mode (CloudLasso): depth histogram per CUT_TILE² CSS px of the mask, BINS bins over the in-shape depth range. */
const CUT_SHIFT = 5;
const CUT_TILE = 1 << CUT_SHIFT;
const BINS = 32;
// ponytail: CloudLasso density threshold, the calibration knob. A tile's front structure starts at
// the first depth bin whose smoothed count reaches FRONT_DENSITY × the tile's peak (and at least
// FRONT_MIN points); lower it to catch fainter fronts, raise it to skip sparse foreground noise.
const FRONT_DENSITY = 0.2;
const FRONT_MIN = 3;

/**
 * Lasso and marquee alike: the shape is rasterized into a mask texture at the
 * overlay's CSS resolution and each point does one `textureLoad` at its
 * projected position, so the cost is O(1) per point at any vertex count, in
 * 2D or 3D. One thread owns one 32-point word.
 *
 * `front` (simplified CloudLasso, Yu et al. 2012) adds three passes: the depth
 * range of the in-shape points, a depth histogram per mask tile, and per tile
 * the bin range of its first dense cluster (from the first bin above the
 * threshold through the peak to the next local minimum); a point is selected
 * when its depth falls in its tile's range.
 */
export function createSelectionEngine(
  root: TgpuRoot,
  scene: Scene,
  onChange: (count: number, bits?: Uint32Array<ArrayBuffer>) => void,
): SelectionEngine {
  const { frame, project, catOf, words, batchInView } = scene;
  const device = root.device;
  const bitsRW = scene.bits.as("mutable");
  const count = root.createMutable(d.atomic(d.u32));
  // In-shape depth range as f32 bits (non-negative floats order like their bits): min, max.
  const range = root.createMutable(d.arrayOf(d.atomic(d.u32), 2));
  const params = root.createUniform(d.struct({ front: d.u32, tilesX: d.u32 }));
  const maskLayout = tgpu.bindGroupLayout({
    mask: { texture: d.texture2d(d.f32) },
    hist: { storage: (len: number) => d.arrayOf(d.atomic(d.u32), len), access: "mutable" },
    cut: { storage: (len: number) => d.arrayOf(d.u32, len), access: "mutable" },
  });

  /** Word w can hold a selectable point: some predicate bit set (when filtered) and its batch in view. */
  const wordLive = tgpu.fn(
    [d.u32],
    d.bool,
  )((w) => {
    "use gpu";
    const f = frame.$;
    const filtered = ((f.flags >>> Bit.predicate) & 1) === 1;
    return (!filtered || bitsRW.$[Bit.predicate * f.words + w] !== 0) && batchInView(w >>> 3);
  });

  /** (depth z/w, mask x, mask y) of point i when drawable and inside the shape; depth −1 otherwise. */
  const hit = tgpu.fn(
    [d.u32],
    d.vec3f,
  )((i) => {
    "use gpu";
    const f = frame.$;
    const miss = d.vec3f(-1, 0, 0);
    if (
      ((f.flags >>> Bit.predicate) & 1) === 1 &&
      ((bitsRW.$[Bit.predicate * f.words + (i >>> 5)] >>> (i & 31)) & 1) === 0
    ) {
      return miss;
    }
    const cat = catOf(i);
    if (
      ((f.flags >>> Bit.disabled) & 1) === 1 &&
      ((bitsRW.$[LAYERS * f.words + 8 + (cat >>> 5)] >>> (cat & 31)) & 1) === 1
    ) {
      return miss;
    }
    // Every point projecting inside counts, occluded or not (not behind the camera).
    const c = project(i);
    if (c.w <= 0 || std.abs(c.x) >= c.w || std.abs(c.y) >= c.w || c.z < 0 || c.z > c.w) return miss;
    const dims = std.textureDimensions(maskLayout.$.mask);
    const px = d.vec2i(
      d.i32(((c.x / c.w) * 0.5 + 0.5) * d.f32(dims.x)),
      d.i32((0.5 - (c.y / c.w) * 0.5) * d.f32(dims.y)),
    );
    if (std.textureLoad(maskLayout.$.mask, px, 0).x <= 0.5) return miss;
    return d.vec3f(c.z / c.w, d.f32(px.x), d.f32(px.y));
  });

  /** Depth bin of an in-shape depth, over the current range. */
  const binOf = tgpu.fn(
    [d.f32],
    d.u32,
  )((depth) => {
    "use gpu";
    const lo = std.bitcast(d.u32, d.f32)(std.atomicLoad(range.$[0]));
    const hi = std.bitcast(d.u32, d.f32)(std.atomicLoad(range.$[1]));
    return std.min(d.u32(((depth - lo) / std.max(hi - lo, 1e-12)) * BINS), BINS - 1);
  });

  const tileOf = tgpu.fn(
    [d.vec3f],
    d.u32,
  )((h) => {
    "use gpu";
    // Shifts: TGSL `/` is float division.
    return (d.u32(h.z) >>> CUT_SHIFT) * params.$.tilesX + (d.u32(h.y) >>> CUT_SHIFT);
  });

  const rangeKernel = root.createGuardedComputePipeline((w: number) => {
    "use gpu";
    if (!wordLive(w)) return;
    for (let k = d.u32(0); k < 32; k++) {
      const i = w * 32 + k;
      if (i >= frame.$.n) break;
      const h = hit(i);
      if (h.x < 0) continue;
      std.atomicMin(range.$[0], std.bitcast(d.f32, d.u32)(h.x));
      std.atomicMax(range.$[1], std.bitcast(d.f32, d.u32)(h.x));
    }
  });

  const histKernel = root.createGuardedComputePipeline((w: number) => {
    "use gpu";
    if (!wordLive(w)) return;
    for (let k = d.u32(0); k < 32; k++) {
      const i = w * 32 + k;
      if (i >= frame.$.n) break;
      const h = hit(i);
      if (h.x >= 0) std.atomicAdd(maskLayout.$.hist[tileOf(h) * BINS + binOf(h.x)], 1);
    }
  });

  /** Smoothed (1, 2, 1) count of bin k of tile `base`. */
  const smooth = tgpu.fn(
    [d.u32, d.u32],
    d.u32,
  )((base, k) => {
    "use gpu";
    let v = std.atomicLoad(maskLayout.$.hist[base + k]) * 2;
    if (k > 0) v += std.atomicLoad(maskLayout.$.hist[base + k - 1]);
    if (k + 1 < BINS) v += std.atomicLoad(maskLayout.$.hist[base + k + 1]);
    return v;
  });

  // Per tile: bins [lo, hi] of its first dense cluster, packed lo | hi << 16 (lo > hi: none).
  const cutKernel = root.createGuardedComputePipeline((tile: number) => {
    "use gpu";
    const base = tile * BINS;
    let peak = d.u32(0);
    for (let k = d.u32(0); k < BINS; k++) peak = std.max(peak, smooth(base, k));
    // Smoothed counts are 4× raw counts.
    const threshold = std.max(d.u32(FRONT_MIN * 4), d.u32(d.f32(peak) * FRONT_DENSITY));
    let lo = d.u32(BINS);
    for (let k = d.u32(0); k < BINS; k++) {
      if (smooth(base, k) >= threshold) {
        lo = k;
        break;
      }
    }
    if (lo === BINS) {
      maskLayout.$.cut[tile] = 1;
      return;
    }
    // Climb to the cluster's peak, then descend to the next local minimum (or an empty bin).
    let hi = lo;
    while (hi + 1 < BINS && smooth(base, hi + 1) >= smooth(base, hi)) hi += 1;
    while (hi + 1 < BINS && smooth(base, hi + 1) <= smooth(base, hi) && smooth(base, hi + 1) > 0) hi += 1;
    // Include the cluster's thin leading edge in front of the first dense bin.
    while (lo > 0 && smooth(base, lo - 1) > 0 && smooth(base, lo - 1) <= smooth(base, lo)) lo -= 1;
    maskLayout.$.cut[tile] = lo | (hi << 16);
  });

  const kernel = root.createGuardedComputePipeline((w: number) => {
    "use gpu";
    let out = d.u32(0);
    if (wordLive(w)) {
      for (let k = d.u32(0); k < 32; k++) {
        const i = w * 32 + k;
        if (i >= frame.$.n) break;
        const h = hit(i);
        if (h.x < 0) continue;
        if (params.$.front === 1) {
          const cut = maskLayout.$.cut[tileOf(h)];
          const bin = binOf(h.x);
          if (bin < (cut & 0xffff) || bin > cut >>> 16) continue;
        }
        out = out | (d.u32(1) << k);
      }
    }
    bitsRW.$[Bit.lasso * frame.$.words + w] = out;
    std.atomicAdd(count.$, std.countOneBits(out));
  });

  const canvas = new OffscreenCanvas(1, 1);
  const ctx = canvas.getContext("2d", { willReadFrequently: false })!;
  let mask: ReturnType<typeof makeMask> | null = null;
  function makeMask(width: number, height: number) {
    const texture = root.createTexture({ size: [width, height], format: "r8unorm" }).$usage("sampled", "render");
    const tilesX = Math.ceil(width / CUT_TILE);
    const tiles = tilesX * Math.ceil(height / CUT_TILE);
    const hist = root.createBuffer(d.arrayOf(d.atomic(d.u32), tiles * BINS)).$usage("storage");
    const cut = root.createBuffer(d.arrayOf(d.u32, tiles)).$usage("storage");
    return { texture, hist, cut, tiles, tilesX, group: root.createBindGroup(maskLayout, { mask: texture, hist, cut }) };
  }

  // Copies run on the queue after the dispatch, so they always see this selection.
  // Drags read 4 bytes; pointer-up also reads the N/8-byte layer. A request made
  // during a readback is coalesced (latest wins), so pointer-up is never dropped.
  const countStaging = device.createBuffer({ size: 4, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
  const bitsStaging = device.createBuffer({
    size: words * 4,
    usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
  });
  let generation = 0;
  const readback = latestOnly(async ({ final, gen }: { final: boolean; gen: number }) => {
    if (gen !== generation) return;
    const t0 = performance.now();
    const encoder = device.createCommandEncoder();
    encoder.copyBufferToBuffer(root.unwrap(count.buffer), 0, countStaging, 0, 4);
    if (final) encoder.copyBufferToBuffer(root.unwrap(scene.rowBits), 0, bitsStaging, 0, words * 4);
    device.queue.submit([encoder.finish()]);
    await Promise.all([countStaging.mapAsync(GPUMapMode.READ), final && bitsStaging.mapAsync(GPUMapMode.READ)]);
    const n = new Uint32Array(countStaging.getMappedRange())[0];
    countStaging.unmap();
    const bits = final ? new Uint32Array(bitsStaging.getMappedRange().slice(0)) : undefined;
    if (final) bitsStaging.unmap();
    if (gen !== generation) return;
    console.log(`${n.toLocaleString()} selected${final ? " (final)" : ""} (${(performance.now() - t0).toFixed(1)}ms)`);
    onChange(n, bits);
  });

  function destroyMask() {
    mask?.texture.destroy();
    mask?.hist.destroy();
    mask?.cut.destroy();
  }

  return {
    run(paint, width, height, final, front) {
      width = Math.max(1, Math.round(width));
      height = Math.max(1, Math.round(height));
      if (canvas.width !== width || canvas.height !== height || !mask) {
        canvas.width = width;
        canvas.height = height;
        destroyMask();
        mask = makeMask(width, height);
      }
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = "#fff";
      paint(ctx);
      // Premultiplied: an anti-aliased edge texel reads its coverage, not full white.
      mask.texture.write(canvas, { premultipliedAlpha: true });
      params.write({ front: front ? 1 : 0, tilesX: mask.tilesX });
      if (front) {
        range.write([0xffffffff, 0]);
        mask.hist.clear();
        rangeKernel.with(mask.group).dispatchThreads(words);
        histKernel.with(mask.group).dispatchThreads(words);
        cutKernel.with(mask.group).dispatchThreads(mask.tiles);
      }
      count.write(0);
      kernel.with(mask.group).dispatchThreads(words);
      // Queued before the readback's copy: the reported bitmask is in row order.
      if (final) scene.layerToRows(Bit.lasso);
      readback({ final, gen: generation });
    },
    clear() {
      generation++;
    },
    destroy() {
      generation++;
      destroyMask();
      countStaging.destroy();
      bitsStaging.destroy();
    },
  };
}
