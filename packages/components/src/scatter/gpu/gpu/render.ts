import { tgpu, type TgpuCommandEncoder } from "typegpu";
import { fullScreenTriangle } from "typegpu/common";
import * as d from "typegpu/data";
import * as std from "typegpu/std";
import type { TgpuRoot } from "../../gpu/types";
import { BATCH, type Scene } from "./scene";

/**
 * 2D only; 3D always draws opaque depth-tested discs.
 * - `additive`: order-independent; dense regions sum and roll off in the HDR tone-map. Default.
 * - `premultiplied`: alpha-over; keeps category identity in overlap but flickers with draw order.
 * - `max`: brightest fragment wins.
 */
export type BlendMode = "additive" | "premultiplied" | "max";

const BLEND_MODES: Record<BlendMode, GPUBlendState> = {
  additive: {
    color: { srcFactor: "one", dstFactor: "one", operation: "add" },
    alpha: { srcFactor: "one", dstFactor: "one", operation: "add" },
  },
  premultiplied: {
    color: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
    alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
  },
  max: {
    color: { srcFactor: "one", dstFactor: "one", operation: "max" },
    alpha: { srcFactor: "one", dstFactor: "one", operation: "max" },
  },
};

// Byte offsets of the indirect records: quad draw, pick draw, density resolve draw, splat
// dispatch, re-compaction dispatch (only when leaving density mode).
const QUAD = 0;
const PICK = 16;
const RESOLVE = 32;
const SPLAT = 48;
const RECOMPACT = 64;
const PICK_WINDOW = 5;
const DEPTH_FORMAT = "depth32float";
/** Density splat: side of a batch's workgroup tile in grid pixels (TILE² = one pixel per thread). */
// Shader index math uses shifts and masks: TGSL `/` is float division.
const TILE_SHIFT = 4;
const TILE = 1 << TILE_SHIFT;
const HALF_TILE = TILE / 2;
/**
 * Categorical compositing (dominant, weave): class weights per CLASS_TILE² px tile, for the
 * first CLASSES palette colors. 4 px × 32 classes: 8 B/px of grid (9 MB at 1366×818).
 */
const CLASS_SHIFT = 2;
export const CLASS_TILE = 1 << CLASS_SHIFT;
const CLASS_BITS = 5;
const CLASSES = 1 << CLASS_BITS;
const TILE_CLASS_SHIFT = TILE_SHIFT - CLASS_SHIFT;
const TILE_CLASSES = 1 << TILE_CLASS_SHIFT;
const TILE_CLASS_CELLS = TILE_CLASSES * TILE_CLASSES;
/** Trajectory line half-width, frame-dot radius, and active-marker radius (CSS px). */
const LINE_HALF = 1.25;
const DOT_R = 3.5;
const ACTIVE_R = 6;

/** Quad corner of vertex vi, two triangles: (-1,-1) (1,-1) (-1,1) | (-1,1) (1,-1) (1,1). */
const corner = tgpu.fn(
  [d.u32],
  d.vec2f,
)((vi) => {
  "use gpu";
  return d.vec2f(
    std.select(d.f32(-1), d.f32(1), vi === 1 || vi >= 4),
    std.select(d.f32(-1), d.f32(1), vi === 2 || vi === 3 || vi === 5),
  );
});

export interface RenderPasses {
  /**
   * Compact in-view visible point ids and write every indirect record (and the
   * quads-vs-density choice). Record it when the camera, a filter, or the data
   * changed. In density mode it only counts (no ids), unless `Frame.writeIds`.
   */
  compact(enc: TgpuCommandEncoder): void;
  /** Draw the points (quads or density, chosen on the GPU) into the HDR `target`. */
  draw(enc: TgpuCommandEncoder, target: GPUTextureView): void;
  /**
   * Point under device pixel (x, y): the visible point nearest the center of a
   * 5×5 window (front-most in 3D) as its storage index and its row, or null.
   * Compacts first, so ids are fresh.
   */
  pick(x: number, y: number): Promise<{ id: number; row: number } | null>;
  setBlendMode(mode: BlendMode): void;
  /** Trajectory path (`ScatterplotHandle.setTrajectoryPath` layout), drawn after the points; null = none. */
  setTrajectory(path: Float32Array | null): void;
  /** Canvas size changed (device px): reallocates the density grid when density can engage. */
  resize(width: number, height: number, densityPossible: boolean): void;
  destroy(): void;
}

export function createRenderPasses(root: TgpuRoot, scene: Scene, hdrFormat: GPUTextureFormat): RenderPasses {
  const {
    frame,
    colors,
    clip,
    project,
    catOf,
    tier,
    tierAlpha,
    visible,
    isoPass,
    pointColor,
    batchLive,
    batchCenter,
    wordPasses,
    perm,
  } = scene;
  const idsRW = scene.ids.as("mutable");
  const idsRO = scene.ids.as("readonly");
  const indirect = root
    .createBuffer(d.arrayOf(d.u32, 20), new Uint32Array([6, 0, 0, 0, 6, 0, 0, 0, 3, 0, 0, 0, 0, 1, 1, 0, 0, 1, 1, 0]))
    .$usage("storage", "indirect");
  const indirectRW = indirect.as("mutable");
  // `live`: batches compaction found on screen (appended to `liveBatches`); `splatBatches`: the
  // count the splat dispatch covers.
  const state = root.createMutable(
    d.struct({ count: d.atomic(d.u32), dense: d.u32, visible: d.u32, live: d.atomic(d.u32), splatBatches: d.u32 }),
  );
  const liveBatches = root.createMutable(d.arrayOf(d.u32, Math.max(1, scene.batches)));
  // 3D: opaque discs, and the density resolve and id pick share their depth attachment.
  const depth = scene.ndim === 3;
  const depthTest = (write: boolean): GPUDepthStencilState | undefined =>
    depth ? { format: DEPTH_FORMAT, depthWriteEnabled: write, depthCompare: write ? "less" : "always" } : undefined;

  // ── Compaction: in view ∧ visible → ids; then one thread writes the indirect records ──
  const inView = tgpu.fn(
    [d.vec4f],
    d.bool,
  )((c) => {
    "use gpu";
    // Margin: the clicked ring is 1.6× the marker; ×2 turns px into NDC. Depth culls
    // 3D points behind the camera or outside near/far (2D: z = 0).
    const mx = (1 + (3.2 * frame.$.pointPx) / frame.$.viewport.x) * c.w;
    const my = (1 + (3.2 * frame.$.pointPx) / frame.$.viewport.y) * c.w;
    return c.w > 0 && std.abs(c.x) <= mx && std.abs(c.y) <= my && c.z >= 0 && c.z <= c.w;
  });

  // A workgroup's 64 words are 8 batches: thread 8k tests batch k once for all 8 of its words and
  // lists it for the splat when it may draw.
  const batchShown = tgpu.workgroupVar(d.arrayOf(d.u32, 8));
  const compactPipeline = root.createComputePipeline({
    compute: tgpu.computeFn({
      workgroupSize: [64],
      in: { gid: d.builtin.globalInvocationId, l: d.builtin.localInvocationIndex },
    })((input) => {
      "use gpu";
      const f = frame.$;
      const w = input.gid.x;
      if ((input.l & 7) === 0) {
        const live = w < f.words && batchLive(w >>> 3);
        batchShown.$[input.l >>> 3] = d.u32(live);
        if (live) liveBatches.$[std.atomicAdd(state.$.live, 1)] = w >>> 3;
      }
      std.workgroupBarrier();
      if (w >= f.words) return;
      // Density mode (last decision) draws no quads, so no ids: only the hysteresis count.
      // ponytail: estimated from every 8th word (×8), the first 32 points of each Morton batch.
      // Count every word if the density switch ever flickers.
      const counting = state.$.dense === 1 && f.writeIds === 0;
      if (counting && (w & 7) !== 0) return;
      // Off-screen batch, or no predicate bit set: nothing to draw in these 32 points.
      if (batchShown.$[input.l >>> 3] === 0 || !wordPasses(w)) return;
      let mask = d.u32(0);
      for (let k = d.u32(0); k < 32; k++) {
        const i = w * 32 + k;
        if (i >= f.n) break;
        if (inView(project(i)) && visible(i, tier(i))) mask = mask | (d.u32(1) << k);
      }
      if (mask === 0) return;
      const hits = std.countOneBits(mask);
      let slot = std.atomicAdd(state.$.count, std.select(hits, hits * 8, counting));
      if (counting) return;
      for (let k = d.u32(0); k < 32; k++) {
        if (((mask >>> k) & 1) === 1) {
          if (slot < f.cap) idsRW.$[slot] = w * 32 + k;
          slot = slot + 1;
        }
      }
    }),
  });

  const finalizePipeline = root.createComputePipeline({
    compute: tgpu.computeFn({ workgroupSize: [1] })(() => {
      "use gpu";
      const f = frame.$;
      const count = std.atomicLoad(state.$.count);
      std.atomicStore(state.$.count, 0);
      const was = state.$.dense;
      let dense = was;
      if (count > f.cap || count > f.densityHi) dense = 1;
      else if (count < f.densityLo) dense = 0;
      state.$.dense = dense;
      state.$.visible = count;
      const shown = std.min(count, f.cap);
      indirectRW.$[1] = std.select(shown, d.u32(0), dense === 1);
      indirectRW.$[5] = shown;
      indirectRW.$[9] = dense;
      // The splat: one workgroup per live batch, up to 32768 across x, rows of those across y.
      const live = std.atomicLoad(state.$.live);
      std.atomicStore(state.$.live, 0);
      state.$.splatBatches = live;
      indirectRW.$[12] = std.select(d.u32(0), std.min(live, 32768), dense === 1);
      indirectRW.$[13] = (live + 32767) >>> 15;
      // Leaving density mode: the counting pass wrote no ids, so compact again.
      indirectRW.$[16] = std.select(d.u32(0), (f.words + 63) >>> 6, was === 1 && dense === 0 && f.writeIds === 0);
    }),
  });

  // After a re-compaction its exact count replaces the estimate. Count 0: none ran (or the
  // estimate was already exactly 0).
  const recountPipeline = root.createComputePipeline({
    compute: tgpu.computeFn({ workgroupSize: [1] })(() => {
      "use gpu";
      const count = std.atomicLoad(state.$.count);
      // The re-compaction's live batches are not splatted (it only runs when leaving density mode).
      std.atomicStore(state.$.live, 0);
      if (count === 0) return;
      std.atomicStore(state.$.count, 0);
      state.$.visible = count;
      const shown = std.min(count, frame.$.cap);
      indirectRW.$[1] = shown;
      indirectRW.$[5] = shown;
    }),
  });

  // ── Instanced quads, vertex-pulled through ids ──
  const quadVertex = tgpu.vertexFn({
    in: { vi: d.builtin.vertexIndex, ii: d.builtin.instanceIndex },
    out: { position: d.builtin.position, color: d.vec4f, uv: d.vec2f, ring: d.f32, id: d.interpolate("flat", d.u32) },
  })((input) => {
    "use gpu";
    const f = frame.$;
    const i = idsRO.$[input.ii];
    const t = tier(i);
    const uv = corner(input.vi);
    const half = f.pointPx * std.select(d.f32(1), d.f32(1.6), t === 3);
    const c = project(i);
    const color = pointColor(i);
    return {
      position: d.vec4f(
        c.x + ((uv.x * half * 2) / f.viewport.x) * c.w,
        c.y + ((uv.y * half * 2) / f.viewport.y) * c.w,
        c.z,
        c.w,
      ),
      color: d.vec4f(color.x, color.y, color.z, color.w * tierAlpha(t)),
      uv,
      ring: std.select(d.f32(0), d.f32(1), t === 3),
      id: i,
    };
  });

  const quadFragment = tgpu.fragmentFn({ in: { color: d.vec4f, uv: d.vec2f, ring: d.f32 }, out: d.vec4f })((input) => {
    "use gpu";
    // Derivatives first, in uniform control flow.
    const dist = std.length(input.uv) - 1.0;
    const fw = std.max(std.fwidth(dist), 0.001);
    const edge = 1 - std.smoothstep(-fw, fw, dist);
    if (input.ring > 0.5) {
      // Clicked point: the quad is 1.6× larger; white 1 px ring around a filled disk at r = 1/1.6.
      const inner = 1 - std.smoothstep(-fw, fw, std.length(input.uv) - 0.625);
      const ringA = edge * (1 - inner) * 0.9;
      const fillA = inner * input.color.w;
      const a = fillA + ringA * (1 - fillA);
      if (a < 0.004) std.discard();
      return d.vec4f(
        input.color.x * inner + ringA * (1 - fillA),
        input.color.y * inner + ringA * (1 - fillA),
        input.color.z * inner + ringA * (1 - fillA),
        a,
      );
    }
    const a = edge * frame.$.opacity * input.color.w;
    if (a < 0.004) std.discard();
    return d.vec4f(input.color.x * a, input.color.y * a, input.color.z * a, a);
  });

  // 3D: opaque discs under the depth test. Dimmed tiers are screen-door transparent
  // (discarded below a per-pixel threshold), which stays order-independent.
  const discFragment = tgpu.fragmentFn({
    in: { pos: d.builtin.position, color: d.vec4f, uv: d.vec2f, ring: d.f32 },
    out: d.vec4f,
  })((input) => {
    "use gpu";
    const r = std.length(input.uv);
    if (r > 1) std.discard();
    if (input.ring > 0.5 && r > 0.625) return d.vec4f(1, 1, 1, 1);
    const noise = std.fract(52.9829189 * std.fract(0.06711056 * input.pos.x + 0.00583715 * input.pos.y));
    if (input.color.w < noise) std.discard();
    return d.vec4f(input.color.x, input.color.y, input.color.z, 1);
  });

  const quadPipeline = (blend: GPUBlendState) =>
    root.createRenderPipeline({
      vertex: quadVertex,
      fragment: quadFragment,
      targets: { format: hdrFormat, blend },
    });
  const discs = depth
    ? root.createRenderPipeline({
        vertex: quadVertex,
        fragment: discFragment,
        targets: { format: hdrFormat },
        depthStencil: depthTest(true),
      })
    : null;
  const quads: Record<BlendMode, ReturnType<typeof quadPipeline>> | null = depth
    ? null
    : {
        additive: quadPipeline(BLEND_MODES.additive),
        premultiplied: quadPipeline(BLEND_MODES.premultiplied),
        max: quadPipeline(BLEND_MODES.max),
      };
  let blendMode: BlendMode = "additive";

  // ── Density LOD: per-pixel atomic weight + color sums, then a resolve ──
  // `hist`: per class tile (CLASS_TILE² px), the weight of each of CLASSES palette colors; only
  // filled for the categorical compositing modes (dominant, weave).
  const accLayout = tgpu.bindGroupLayout({
    acc: { storage: (len: number) => d.arrayOf(d.atomic(d.u32), len), access: "mutable" },
    hist: { storage: (len: number) => d.arrayOf(d.atomic(d.u32), len), access: "mutable" },
  });

  // One workgroup per live batch. Morton order keeps a batch on a few pixels, so its points
  // first sum into a workgroup tile (TILE² pixels around the batch's projected center) and each
  // touched tile pixel then costs 4 global atomics instead of 4 per point. Points outside the
  // tile (sparse batches) add to the grid directly. Class weights reduce the same way.
  const tileSum = tgpu.workgroupVar(d.arrayOf(d.atomic(d.u32), TILE * TILE * 4));
  const tileClass = tgpu.workgroupVar(d.arrayOf(d.atomic(d.u32), TILE_CLASS_CELLS * CLASSES));
  // Thread 0's verdict for the workgroup: (live, tile origin x, y); the origin is class-tile aligned.
  const batchTile = tgpu.workgroupVar(d.vec3i);
  const splatPipeline = root.createComputePipeline({
    compute: tgpu.computeFn({
      workgroupSize: [BATCH],
      in: { wid: d.builtin.workgroupId, t: d.builtin.localInvocationIndex },
    })((input) => {
      "use gpu";
      const f = frame.$;
      const slot = input.wid.y * 32768 + input.wid.x;
      const b = liveBatches.$[slot];
      const t = input.t;
      if (t === 0) {
        // Tile centered on the batch's projected center; behind the camera, no tile.
        const center = batchCenter(b);
        let verdict = d.vec3i(d.i32(slot < state.$.splatBatches), -0x40000000, -0x40000000);
        if (center.w > 0) {
          const x = d.i32(((center.x / center.w) * 0.5 + 0.5) * d.f32(f.grid.x)) - HALF_TILE;
          const y = d.i32((0.5 - (center.y / center.w) * 0.5) * d.f32(f.grid.y)) - HALF_TILE;
          verdict.y = x & -CLASS_TILE;
          verdict.z = y & -CLASS_TILE;
        }
        batchTile.$ = d.vec3i(verdict);
      }
      for (let k = d.u32(0); k < 4; k++) std.atomicStore(tileSum.$[t * 4 + k], 0);
      const classes = f.densityMode !== 0 && f.colorBy === 0;
      if (classes) {
        for (let k = d.u32(0); k < 2; k++) std.atomicStore(tileClass.$[t * 2 + k], 0);
      }
      const tile = std.workgroupUniformLoad(batchTile.$);
      if (tile.x === 0) return;
      const origin = tile.yz;
      const i = b * BATCH + t;
      if (i < f.n) {
        const c = project(i);
        const tt = tier(i);
        if (c.w > 0 && std.abs(c.x) < c.w && std.abs(c.y) < c.w && c.z >= 0 && c.z <= c.w && visible(i, tt)) {
          const color = pointColor(i);
          const weight = color.w * tierAlpha(tt) * 255;
          const sums = d.vec4u(
            d.u32(weight),
            d.u32(color.x * weight),
            d.u32(color.y * weight),
            d.u32(color.z * weight),
          );
          const gx = std.min(d.u32(((c.x / c.w) * 0.5 + 0.5) * d.f32(f.grid.x)), f.grid.x - 1);
          const gy = std.min(d.u32((0.5 - (c.y / c.w) * 0.5) * d.f32(f.grid.y)), f.grid.y - 1);
          const local = std.sub(d.vec2i(d.i32(gx), d.i32(gy)), origin);
          const inTile = local.x >= 0 && local.x < TILE && local.y >= 0 && local.y < TILE;
          if (inTile) {
            const cell = d.u32(local.y * TILE + local.x) * 4;
            for (let ch = d.u32(0); ch < 4; ch++) std.atomicAdd(tileSum.$[cell + ch], sums[ch]);
          } else {
            const o = (gy * f.grid.x + gx) * 4;
            for (let ch = d.u32(0); ch < 4; ch++) std.atomicAdd(accLayout.$.acc[o + ch], sums[ch]);
          }
          if (classes) {
            // ponytail: palette colors past CLASSES fold onto the first ones in dominant/weave.
            const cls = (catOf(i) % f.paletteLen) & (CLASSES - 1);
            if (inTile) {
              const cell = d.u32((local.y >> CLASS_SHIFT) * TILE_CLASSES + (local.x >> CLASS_SHIFT));
              std.atomicAdd(tileClass.$[cell * CLASSES + cls], sums.x);
            } else {
              const cell = (gy >>> CLASS_SHIFT) * f.classTiles + (gx >>> CLASS_SHIFT);
              std.atomicAdd(accLayout.$.hist[cell * CLASSES + cls], sums.x);
            }
          }
        }
      }
      std.workgroupBarrier();
      // Flush: thread t owns tile pixel t and class-tile entries 2t, 2t + 1.
      const weight = std.atomicLoad(tileSum.$[t * 4]);
      if (weight > 0) {
        const o = (d.u32(origin.y + d.i32(t >>> TILE_SHIFT)) * f.grid.x + d.u32(origin.x + d.i32(t & (TILE - 1)))) * 4;
        std.atomicAdd(accLayout.$.acc[o], weight);
        for (let ch = d.u32(1); ch < 4; ch++)
          std.atomicAdd(accLayout.$.acc[o + ch], std.atomicLoad(tileSum.$[t * 4 + ch]));
      }
      if (classes) {
        for (let k = d.u32(0); k < 2; k++) {
          const e = t * 2 + k;
          const v = std.atomicLoad(tileClass.$[e]);
          if (v > 0) {
            const cell = e >>> CLASS_BITS;
            const cx = d.u32(origin.x >> CLASS_SHIFT) + (cell & (TILE_CLASSES - 1));
            const cy = d.u32(origin.y >> CLASS_SHIFT) + (cell >>> TILE_CLASS_SHIFT);
            std.atomicAdd(accLayout.$.hist[(cy * f.classTiles + cx) * CLASSES + (e & (CLASSES - 1))], v);
          }
        }
      }
    }),
  });

  // Coverage 1 − e^(−weight·opacity) from the pixel's own weight; color by `densityMode` (Jo et al.
  // 2019): mean = the average color (hue survives any density); categorical colors only:
  // dominant = the class with the most weight in the pixel's class tile, weave = a class drawn per
  // pixel with probability ∝ its share of the tile (a fixed dither, so it does not flicker).
  const resolvePipeline = root.createRenderPipeline({
    vertex: fullScreenTriangle,
    fragment: tgpu.fragmentFn({ in: { pos: d.builtin.position }, out: d.vec4f })((input) => {
      "use gpu";
      const f = frame.$;
      const px = d.u32(input.pos.x);
      const py = d.u32(input.pos.y);
      const o = (py * f.grid.x + px) * 4;
      const w = d.f32(std.atomicLoad(accLayout.$.acc[o]));
      if (w === 0) std.discard();
      const a = 1 - std.exp((-w / 255) * f.opacity);
      if (f.densityMode === 0 || f.colorBy !== 0) {
        const k = a / w;
        return d.vec4f(
          d.f32(std.atomicLoad(accLayout.$.acc[o + 1])) * k,
          d.f32(std.atomicLoad(accLayout.$.acc[o + 2])) * k,
          d.f32(std.atomicLoad(accLayout.$.acc[o + 3])) * k,
          a,
        );
      }
      const base = ((py >>> CLASS_SHIFT) * f.classTiles + (px >>> CLASS_SHIFT)) * CLASSES;
      const n = std.min(f.paletteLen, CLASSES);
      let total = d.u32(0);
      let best = d.u32(0);
      let bestWeight = d.u32(0);
      for (let c = d.u32(0); c < n; c++) {
        const v = std.atomicLoad(accLayout.$.hist[base + c]);
        total += v;
        if (v > bestWeight) {
          best = c;
          bestWeight = v;
        }
      }
      if (f.densityMode === 2) {
        // Interleaved-gradient noise in [0, 1) picks a point on the tile's cumulative class weights.
        const u = std.fract(52.9829189 * std.fract(0.06711056 * input.pos.x + 0.00583715 * input.pos.y));
        const target = u * d.f32(total);
        let sum = d.f32(0);
        for (let c = d.u32(0); c < n; c++) {
          sum += d.f32(std.atomicLoad(accLayout.$.hist[base + c]));
          if (sum > target) {
            best = c;
            break;
          }
        }
      }
      const color = colors.$[best];
      return d.vec4f(color.x * a, color.y * a, color.z * a, a);
    }),
    targets: { format: hdrFormat },
    depthStencil: depthTest(false),
  });

  // ── Trajectory: one screen-space quad per segment (round caps), then a dot per frame and the
  // active-frame marker, all through the points' `clip`, so the path sits on its points. 3D:
  // depth-tested against the discs (no depth write); the active marker also draws dimmed
  // through whatever occludes it. Path layout: see `ScatterplotHandle.setTrajectoryPath`.
  const pathLayout = tgpu.bindGroupLayout({
    path: { storage: (len: number) => d.arrayOf(d.vec4f, len), access: "readonly" },
  });
  const pathTarget = { format: hdrFormat, blend: BLEND_MODES.premultiplied };
  const pathDepth: GPUDepthStencilState | undefined = depth
    ? { format: DEPTH_FORMAT, depthWriteEnabled: false, depthCompare: "less-equal" }
    : undefined;
  const offscreen = d.vec4f(0, 0, 2, 1);

  const segmentVertex = tgpu.vertexFn({
    in: { vi: d.builtin.vertexIndex, ii: d.builtin.instanceIndex },
    out: {
      position: d.builtin.position,
      color: d.interpolate("linear", d.vec4f),
      // Device px from the segment start: x along it (0 … len), y across.
      local: d.interpolate("linear", d.vec2f),
      len: d.interpolate("flat", d.f32),
    },
  })((input) => {
    "use gpu";
    const f = frame.$;
    const a = pathLayout.$.path[input.ii * 2];
    const b = pathLayout.$.path[input.ii * 2 + 2];
    const ca = clip(a.xyz);
    const cb = clip(b.xyz);
    const uv = corner(input.vi);
    const atB = uv.x > 0;
    const c = std.select(ca, cb, atB);
    const half = std.mul(f.viewport, 0.5);
    const pa = std.mul(std.div(ca.xy, ca.w), half);
    const pb = std.mul(std.div(cb.xy, cb.w), half);
    const len = std.distance(pa, pb);
    const dir = std.select(d.vec2f(1, 0), std.div(std.sub(pb, pa), len), len > 0.0001);
    // +1 px for the anti-aliased edge.
    const hw = LINE_HALF * f.cssPx + 1;
    const offset = std.add(std.mul(dir, uv.x * hw), std.mul(d.vec2f(-dir.y, dir.x), uv.y * hw));
    const xy = std.add(c.xy, std.mul(std.div(offset, half), c.w));
    // A break between trajectories, or an end behind the camera: no quad.
    const skip = a.w < 0 || b.w < 0 || ca.w <= 0 || cb.w <= 0;
    return {
      position: std.select(d.vec4f(xy, c.z, c.w), offscreen, skip),
      color: pathLayout.$.path[std.select(input.ii * 2 + 1, input.ii * 2 + 3, atB)],
      local: d.vec2f(std.select(d.f32(0), len, atB) + uv.x * hw, uv.y * hw),
      len,
    };
  });

  const segmentFragment = tgpu.fragmentFn({
    in: {
      color: d.interpolate("linear", d.vec4f),
      local: d.interpolate("linear", d.vec2f),
      len: d.interpolate("flat", d.f32),
    },
    out: d.vec4f,
  })((input) => {
    "use gpu";
    // Distance to the segment: round caps, which also close the joins.
    const along = input.local.x - std.clamp(input.local.x, 0, input.len);
    const dist = std.length(d.vec2f(along, input.local.y));
    const hw = LINE_HALF * frame.$.cssPx;
    const a = input.color.w * (1 - std.smoothstep(hw - 0.5, hw + 0.5, dist));
    if (a < 0.004) std.discard();
    return d.vec4f(input.color.x * a, input.color.y * a, input.color.z * a, a);
  });

  const markVertex = tgpu.vertexFn({
    in: { vi: d.builtin.vertexIndex, ii: d.builtin.instanceIndex },
    out: {
      position: d.builtin.position,
      color: d.vec4f,
      // Device px from the center.
      uv: d.vec2f,
      current: d.interpolate("flat", d.u32),
    },
  })((input) => {
    "use gpu";
    const f = frame.$;
    const v = pathLayout.$.path[input.ii * 2];
    const c = clip(v.xyz);
    const current = v.w > 0.5;
    const r = std.select(d.f32(DOT_R), d.f32(ACTIVE_R), current) * f.cssPx + 1;
    const uv = std.mul(corner(input.vi), r);
    const xy = std.add(c.xy, std.mul(std.div(std.mul(uv, 2), f.viewport), c.w));
    // A hair in front of the point's own disc (same center depth); 2D (z = 0) must stay ≥ 0.
    const marker = d.vec4f(xy, std.max(c.z - 0.0001 * c.w, 0), c.w);
    return {
      position: std.select(marker, offscreen, v.w < 0 || c.w <= 0),
      color: pathLayout.$.path[input.ii * 2 + 1],
      uv,
      current: d.u32(current),
    };
  });

  /** `see` < 1: the see-through draw of only the active marker, at that alpha. */
  const markFragment = (see: number) =>
    tgpu.fragmentFn({
      in: { color: d.vec4f, uv: d.vec2f, current: d.interpolate("flat", d.u32) },
      out: d.vec4f,
    })((input) => {
      "use gpu";
      const px = frame.$.cssPx;
      // `active` is a WGSL reserved word.
      const current = input.current === 1;
      if (see < 1 && !current) std.discard();
      const dist = std.length(input.uv);
      const r = std.select(d.f32(DOT_R), d.f32(ACTIVE_R), current) * px;
      // Opaque, as the SVG dots were. Active: a white disc in a 2 px ring of the frame's color.
      const white = current && dist < r - 2 * px;
      const rgb = std.select(input.color.xyz, d.vec3f(1), white);
      const a = see * (1 - std.smoothstep(r - 0.5, r + 0.5, dist));
      if (a < 0.004) std.discard();
      return d.vec4f(std.mul(rgb, a), a);
    });

  const segments = root.createRenderPipeline({
    vertex: segmentVertex,
    fragment: segmentFragment,
    targets: pathTarget,
    depthStencil: pathDepth,
  });
  const marks = root.createRenderPipeline({
    vertex: markVertex,
    fragment: markFragment(1),
    targets: pathTarget,
    depthStencil: pathDepth,
  });
  const ghosts = depth
    ? root.createRenderPipeline({
        vertex: markVertex,
        fragment: markFragment(0.35),
        targets: pathTarget,
        depthStencil: { format: DEPTH_FORMAT, depthWriteEnabled: false, depthCompare: "always" },
      })
    : null;
  function makePath(p: Float32Array) {
    const buffer = root.createBuffer(d.arrayOf(d.vec4f, p.length / 4)).$usage("storage");
    root.device.queue.writeBuffer(root.unwrap(buffer), 0, p.buffer, p.byteOffset, p.byteLength);
    return { buffer, group: root.createBindGroup(pathLayout, { path: buffer }), frames: p.length / 8 };
  }
  let path: ReturnType<typeof makePath> | null = null;

  function makeAcc(width: number, height: number) {
    const buffer = root.createBuffer(d.arrayOf(d.atomic(d.u32), width * height * 4)).$usage("storage");
    const tiles = Math.ceil(width / CLASS_TILE) * Math.ceil(height / CLASS_TILE);
    const hist = root.createBuffer(d.arrayOf(d.atomic(d.u32), tiles * CLASSES)).$usage("storage");
    return { buffer, hist, group: root.createBindGroup(accLayout, { acc: buffer, hist }) };
  }
  let acc: ReturnType<typeof makeAcc> | null = null;

  // ── Pick: (storage id + 1, row) through the same vertex function, scissored to 5×5 ──
  const pickPipeline = root.createRenderPipeline({
    vertex: quadVertex,
    fragment: tgpu.fragmentFn({ in: { uv: d.vec2f, id: d.interpolate("flat", d.u32) }, out: d.vec4u })((input) => {
      "use gpu";
      // Isolation-dimmed points are not clickable.
      if (std.length(input.uv) > 1 || isoPass(input.id) === 0) std.discard();
      return d.vec4u(input.id + 1, perm.$[input.id], 0, 0);
    }),
    targets: { format: "rg32uint" },
    depthStencil: depthTest(true),
  });
  // 5 rows at the 256-byte row pitch copyTextureToBuffer requires; 25 (id, row) texels are read.
  const pickStaging = root.device.createBuffer({
    size: 256 * (PICK_WINDOW - 1) + 8 * PICK_WINDOW,
    usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
  });
  // Allocated on the first click after each resize.
  let size: [number, number] = [1, 1];
  let idTarget: ReturnType<typeof makeIdTarget> | null = null;
  function makeIdTarget() {
    return root.createTexture({ size, format: "rg32uint" }).$usage("render");
  }
  let pickChain: Promise<unknown> = Promise.resolve();
  // 3D: shared by the draw and pick passes, reallocated on resize.
  let depthTarget: ReturnType<typeof makeDepth> | null = null;
  function makeDepth() {
    return root.createTexture({ size, format: DEPTH_FORMAT }).$usage("render");
  }
  const depthAttachment = () =>
    depthTarget
      ? { view: depthTarget, depthClearValue: 1, depthLoadOp: "clear" as const, depthStoreOp: "discard" as const }
      : undefined;

  function compact(enc: TgpuCommandEncoder) {
    const pass = enc.beginComputePass();
    compactPipeline.with(pass).dispatchWorkgroups(Math.ceil(scene.words / 64));
    finalizePipeline.with(pass).dispatchWorkgroups(1);
    compactPipeline.with(pass).dispatchWorkgroupsIndirect(indirect, RECOMPACT);
    recountPipeline.with(pass).dispatchWorkgroups(1);
    pass.end();
  }

  return {
    compact,
    draw(enc, target) {
      if (acc) {
        root.unwrap(enc).clearBuffer(root.unwrap(acc.buffer));
        // Cleared in every mode: one ~9 MB clear is cheaper than tracking the mode here.
        root.unwrap(enc).clearBuffer(root.unwrap(acc.hist));
        const pass = enc.beginComputePass();
        splatPipeline.with(pass).with(acc.group).dispatchWorkgroupsIndirect(indirect, SPLAT);
        pass.end();
      }
      const pass = enc.beginRenderPass({
        colorAttachments: [{ view: target, clearValue: [0, 0, 0, 0] }],
        depthStencilAttachment: depthAttachment(),
      });
      (discs ?? quads![blendMode]).with(pass).drawIndirect(indirect, QUAD);
      if (acc) resolvePipeline.with(pass).with(acc.group).drawIndirect(indirect, RESOLVE);
      if (path) {
        segments
          .with(pass)
          .with(path.group)
          .draw(6, path.frames - 1);
        ghosts?.with(pass).with(path.group).draw(6, path.frames);
        marks.with(pass).with(path.group).draw(6, path.frames);
      }
      pass.end();
    },
    pick(x, y) {
      const job = pickChain.then(async () => {
        const enc = root["~unstable"].createCommandEncoder();
        // Fresh ids even in density mode: the pick draw reads them. Queue order scopes the flag to this submit.
        frame.patch({ writeIds: 1 });
        compact(enc);
        idTarget ??= makeIdTarget();
        const target = idTarget;
        const x0 = Math.max(0, Math.min(Math.floor(x) - 2, size[0] - PICK_WINDOW));
        const y0 = Math.max(0, Math.min(Math.floor(y) - 2, size[1] - PICK_WINDOW));
        const pass = enc.beginRenderPass({
          colorAttachments: [{ view: target, clearValue: [0, 0, 0, 0] }],
          depthStencilAttachment: depthAttachment(),
        });
        pass.setScissorRect(x0, y0, PICK_WINDOW, PICK_WINDOW);
        pickPipeline.with(pass).drawIndirect(indirect, PICK);
        pass.end();
        root
          .unwrap(enc)
          .copyTextureToBuffer(
            { texture: root.unwrap(target), origin: { x: x0, y: y0 } },
            { buffer: pickStaging, bytesPerRow: 256 },
            { width: PICK_WINDOW, height: PICK_WINDOW },
          );
        enc.submit();
        frame.patch({ writeIds: 0 });
        await pickStaging.mapAsync(GPUMapMode.READ);
        const words = new Uint32Array(pickStaging.getMappedRange());
        // Nearest hit to the cursor wins (in 3D each pixel already holds its front-most point).
        let best: { id: number; row: number } | null = null;
        let bestDist = Infinity;
        for (let row = 0; row < PICK_WINDOW; row++) {
          for (let col = 0; col < PICK_WINDOW; col++) {
            const texel = row * 64 + col * 2;
            const dist = (x0 + col - x) ** 2 + (y0 + row - y) ** 2;
            if (words[texel] !== 0 && dist < bestDist) {
              best = { id: words[texel] - 1, row: words[texel + 1] };
              bestDist = dist;
            }
          }
        }
        pickStaging.unmap();
        return best;
      });
      pickChain = job.catch(() => {});
      return job;
    },
    setBlendMode(mode) {
      blendMode = mode;
    },
    setTrajectory(p) {
      path?.buffer.destroy();
      path = p && p.length >= 8 ? makePath(p) : null;
    },
    resize(width, height, densityPossible) {
      size = [width, height];
      idTarget?.destroy();
      idTarget = null;
      depthTarget?.destroy();
      depthTarget = depth ? makeDepth() : null;
      acc?.buffer.destroy();
      acc?.hist.destroy();
      acc = densityPossible ? makeAcc(width, height) : null;
    },
    destroy() {
      idTarget?.destroy();
      depthTarget?.destroy();
      pickStaging.destroy();
    },
  };
}
