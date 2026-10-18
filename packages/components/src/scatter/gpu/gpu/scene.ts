import { tgpu, type StorageFlag, type TgpuBuffer, type TgpuFn, type TgpuReadonly, type TgpuUniform } from "typegpu";
import * as d from "typegpu/data";
import * as std from "typegpu/std";
import type { TgpuRoot } from "../../gpu/types";

/** "No point": the clicked-point sentinel. */
export const NONE = 0xffffffff;
/** Points per batch: 256 consecutive storage-order points, 8 bit-layer words. */
export const BATCH = 256;

/**
 * Bits of `Frame.flags`. The first six are also bit layers: N/32 words each,
 * packed into one buffer (layer k at word k·words) so the vertex stage binds a
 * single storage buffer. Two 256-category bitsets (8 words each: isolated,
 * then disabled) follow the layers.
 */
export const Bit = {
  predicate: 0,
  lasso: 1,
  external: 2,
  trajectory: 3,
  continuous: 4,
  highlight: 5,
  isolated: 6,
  disabled: 7,
  /** Tier-0 (failed filter) points are hidden instead of dimmed. */
  hideDimmed: 8,
} as const;
export const LAYERS = 6;

export const Frame = d.struct({
  viewProj: d.mat4x4f,
  /** Canvas size, device px. */
  viewport: d.vec2f,
  /** Marker half-size, device px. */
  pointPx: d.f32,
  opacity: d.f32,
  /** Alpha of tier-0 (heavily dimmed) points. */
  dim: d.f32,
  vmin: d.f32,
  vmax: d.f32,
  n: d.u32,
  words: d.u32,
  flags: d.u32,
  /** Storage index of the clicked point, or NONE. */
  clicked: d.u32,
  /** 0 = palette by category; 1/2/3 = LUT by value with linear/log/sqrt normalization. */
  colorBy: d.u32,
  reversed: d.u32,
  paletteLen: d.u32,
  /** Density-path hysteresis: enter above `densityHi` visible points, leave below `densityLo`. */
  densityHi: d.u32,
  densityLo: d.u32,
  /** Capacity of `ids`; more visible points than this force the density path. */
  cap: d.u32,
  /** 1: compaction writes ids even in density mode (the pick pass draws them). */
  writeIds: d.u32,
  /** Density splat grid: the canvas in device px (a half-res grid quadrupled atomic contention: 4.2 vs 2.5 ms at 10M). */
  grid: d.vec2u,
  /** Density compositing of categorical colors: 0 = mean, 1 = dominant, 2 = weave. */
  densityMode: d.u32,
  /** Class tiles per grid row (see render.ts CLASS_TILE). */
  classTiles: d.u32,
  /** Device px per CSS px. */
  cssPx: d.f32,
});
export type FrameState = d.InferInput<typeof Frame>;

type PointFn<R extends d.AnyWgslData> = TgpuFn<(i: d.U32) => R>;
type U32Array = d.WgslArray<d.U32>;
type F32Array = d.WgslArray<d.F32>;

/**
 * The per-view GPU scene: readonly SoA point data, bit layers, the frame
 * uniform, and the TGSL helpers every pass shares, so render, compaction,
 * selection, density, and pick agree by construction.
 *
 * Points live in **storage order** (Morton order of their positions, so 256
 * consecutive points form a compact batch with a bounding box); `perm` maps a
 * storage index to its row. Storage order never leaves the scene/render
 * implementation (only `render.ts` reads `perm`): callers see row order alone,
 * since every setter takes row order, `rowBits` reports row order, and the
 * pick pass returns rows.
 */
export interface Scene {
  readonly n: number;
  readonly ndim: 2 | 3;
  /** Words per bit layer: ceil(n / 32). */
  readonly words: number;
  /** Number of 256-point batches: ceil(n / 256). */
  readonly batches: number;
  /** Capacity of `ids`. */
  readonly cap: number;
  /** GPU bytes held per point by the point buffers (incl. `perm`, `batchBounds`, `rowBits`). */
  readonly bytes: number;
  readonly posX: TgpuReadonly<F32Array>;
  readonly posY: TgpuReadonly<F32Array>;
  /** 3D only. */
  readonly posZ: TgpuReadonly<F32Array> | null;
  /** Storage index → row index. */
  readonly perm: TgpuReadonly<U32Array>;
  readonly bits: TgpuBuffer<U32Array> & StorageFlag;
  readonly ids: TgpuBuffer<U32Array> & StorageFlag;
  /** Row-order bitmask (N/32 words) written by `layerToRows`. */
  readonly rowBits: TgpuBuffer<d.WgslArray<d.Atomic<d.U32>>> & StorageFlag;
  readonly frame: TgpuUniform<typeof Frame>;
  readonly colors: TgpuUniform<d.WgslArray<d.Vec4f>>;
  /** Clip-space position of a world point: `viewProj · (p, 1)`. */
  readonly clip: TgpuFn<(p: d.Vec3f) => d.Vec4f>;
  /** Clip-space position of point i: `clip(x, y, z or 0)`. */
  readonly project: PointFn<d.Vec4f>;
  /** Category index of point i. */
  readonly catOf: PointFn<d.U32>;
  /** 1 when point i passes isolation (category · trajectory · continuous range). */
  readonly isoPass: PointFn<d.U32>;
  /** Brightness tier: 3 = clicked (ring), 2 = full, 1 = moderate dim, 0 = heavy dim. */
  readonly tier: PointFn<d.U32>;
  readonly tierAlpha: TgpuFn<(t: d.U32) => d.F32>;
  /** Drawn at all, given the point and its tier. */
  readonly visible: TgpuFn<(i: d.U32, t: d.U32) => d.Bool>;
  readonly pointColor: PointFn<d.Vec4f>;
  /** Batch b's bounding box may touch the view (frustum with the marker margin). Reads no bit layer. */
  readonly batchInView: TgpuFn<(b: d.U32) => d.Bool>;
  /** Batch b may hold a drawable point: in view, and some predicate bit set when filtered. */
  readonly batchLive: TgpuFn<(b: d.U32) => d.Bool>;
  /** Clip-space center of batch b's bounding box. */
  readonly batchCenter: TgpuFn<(b: d.U32) => d.Vec4f>;
  /** Word w (32 points) has a predicate bit set, or no predicate is active. */
  readonly wordPasses: TgpuFn<(w: d.U32) => d.Bool>;
  /** Row-order u8 categories → storage order. */
  writeCategories(rows: Uint8Array): void;
  /** Row-order continuous values → storage order. */
  writeValues(rows: Float32Array): void;
  /** Row-order bitmask (bit r of word r/32 = row r; missing words are 0) → bit layer `bit`. */
  writeLayer(bit: number, rows: Uint32Array): void;
  /** Bit layer `bit` → `rowBits` in row order (queued; read it back after this call). */
  layerToRows(bit: number): void;
}

/** Spread the low 16 bits of v to the even bits (2D Morton). */
function spread2(v: number): number {
  v = (v | (v << 8)) & 0x00ff00ff;
  v = (v | (v << 4)) & 0x0f0f0f0f;
  v = (v | (v << 2)) & 0x33333333;
  return (v | (v << 1)) & 0x55555555;
}

/** Spread the low 10 bits of v to every third bit (3D Morton). */
function spread3(v: number): number {
  v = (v | (v << 16)) & 0x030000ff;
  v = (v | (v << 8)) & 0x0300f00f;
  v = (v | (v << 4)) & 0x030c30c3;
  return (v | (v << 2)) & 0x09249249;
}

/**
 * Storage order: a stable LSD radix sort of the points' Morton keys (16 bits per
 * axis in 2D, 10 in 3D) over positions in [-1, 1] (NaN → 0). Returns storage → row.
 * ponytail: CPU on the main thread (~100 ms at 10M in Chrome, during upload). Move it to a
 * Worker or a GPU radix sort if upload jank ever matters.
 */
export function mortonOrder(positions: Float32Array, n: number, ndim: 2 | 3): Uint32Array<ArrayBuffer> {
  const bits = ndim === 3 ? 10 : 16;
  const scale = (1 << bits) - 1;
  const half = 0.5 * scale;
  const x = positions.subarray(0, n);
  const y = positions.subarray(n, 2 * n);
  let keys = new Uint32Array(n);
  if (ndim === 3) {
    const z = positions.subarray(2 * n, 3 * n);
    for (let i = 0; i < n; i++) {
      const qx = Math.min(scale, Math.max(0, ((x[i] + 1) * half) | 0));
      const qy = Math.min(scale, Math.max(0, ((y[i] + 1) * half) | 0));
      const qz = Math.min(scale, Math.max(0, ((z[i] + 1) * half) | 0));
      keys[i] = spread3(qx) | (spread3(qy) << 1) | (spread3(qz) << 2);
    }
  } else {
    for (let i = 0; i < n; i++) {
      const qx = Math.min(scale, Math.max(0, ((x[i] + 1) * half) | 0));
      const qy = Math.min(scale, Math.max(0, ((y[i] + 1) * half) | 0));
      keys[i] = spread2(qx) | (spread2(qy) << 1);
    }
  }
  // 3 passes: 11-bit digits for 32-bit 2D keys, 10-bit for 30-bit 3D keys.
  const digit = ndim === 3 ? 10 : 11;
  const mask = (1 << digit) - 1;
  const offsets = new Uint32Array(1 << digit);
  let perm = new Uint32Array(n);
  let keysOut = new Uint32Array(n);
  let permOut = new Uint32Array(n);
  for (let shift = 0; shift < ndim * bits; shift += digit) {
    offsets.fill(0);
    for (let i = 0; i < n; i++) offsets[(keys[i] >>> shift) & mask]++;
    for (let b = 0, sum = 0; b <= mask; b++) {
      const count = offsets[b];
      offsets[b] = sum;
      sum += count;
    }
    for (let i = 0; i < n; i++) {
      const dst = offsets[(keys[i] >>> shift) & mask]++;
      keysOut[dst] = keys[i];
      permOut[dst] = shift === 0 ? i : perm[i];
    }
    [keys, keysOut] = [keysOut, keys];
    [perm, permOut] = [permOut, perm];
  }
  return perm;
}

export function createScene(root: TgpuRoot, positions: Float32Array, n: number, cap: number, ndim: 2 | 3): Scene {
  const words = Math.ceil(n / 32);
  const batches = Math.ceil(n / BATCH);
  const column = () => root.createBuffer(d.arrayOf(d.f32, Math.max(1, n))).$usage("storage");
  const xBuf = column();
  const yBuf = column();
  // No z column in 2D.
  const zBuf = ndim === 3 ? column() : null;
  // Category u8 ×4 per word; continuous values f32.
  const catBuf = root.createBuffer(d.arrayOf(d.u32, Math.max(1, Math.ceil(n / 4)))).$usage("storage");
  const valueBuf = column();
  const tSort = performance.now();
  const order = mortonOrder(positions, n, ndim);
  console.log(`Storage order (Morton sort): ${(performance.now() - tSort).toFixed(1)}ms`);
  const permBuf = root.createBuffer(d.arrayOf(d.u32, Math.max(1, n)), order).$usage("storage");
  // Per batch: min corner, then max corner (w unused).
  const boundsBuf = root.createBuffer(d.arrayOf(d.vec4f, Math.max(1, 2 * batches))).$usage("storage");
  const bits = root.createBuffer(d.arrayOf(d.u32, LAYERS * words + 16)).$usage("storage");
  const rowBits = root.createBuffer(d.arrayOf(d.atomic(d.u32), Math.max(1, words))).$usage("storage");
  // Compacted visible point ids, written by compaction, read by the quad and pick draws.
  const ids = root.createBuffer(d.arrayOf(d.u32, Math.max(1, cap))).$usage("storage");
  const posX = xBuf.as("readonly");
  const posY = yBuf.as("readonly");
  const posZ = zBuf?.as("readonly") ?? null;
  const cats = catBuf.as("readonly");
  const values = valueBuf.as("readonly");
  const perm = permBuf.as("readonly");
  const boundsRO = boundsBuf.as("readonly");
  const bitsRO = bits.as("readonly");
  const frame = root.createUniform(Frame);
  // Categorical palette (first `paletteLen` entries) or the 256-entry continuous LUT.
  const colors = root.createUniform(d.arrayOf(d.vec4f, 256));

  // ── Row order → storage order: out word w packs elements w·per … w·per+per−1, each the
  // element at row perm[s] of the row-order input (per = 1 << shift: 1 f32, 4 u8, or 32 bits).
  const gatherLayout = tgpu.bindGroupLayout({
    src: { storage: (len: number) => d.arrayOf(d.u32, len), access: "readonly" },
    dst: { storage: (len: number) => d.arrayOf(d.u32, len), access: "mutable" },
  });
  const gatherParams = root.createUniform(d.struct({ shift: d.u32, offset: d.u32 }));
  const gatherKernel = root.createGuardedComputePipeline((w: number) => {
    "use gpu";
    const shift = gatherParams.$.shift;
    const width = d.u32(32) >>> shift;
    const mask = std.select(d.u32(0xffffffff), (d.u32(1) << width) - 1, shift > 0);
    let out = d.u32(0);
    for (let j = d.u32(0); j < d.u32(1) << shift; j++) {
      const s = (w << shift) + j;
      if (s >= frame.$.n) break;
      const r = perm.$[s];
      const e = (gatherLayout.$.src[r >>> shift] >>> ((r & ((d.u32(1) << shift) - 1)) * width)) & mask;
      out = out | (e << (j * width));
    }
    gatherLayout.$.dst[gatherParams.$.offset + w] = out;
  });
  function gather(dst: GPUBuffer, rows: ArrayBufferView, shift: 0 | 2 | 5, offset = 0) {
    const outWords = Math.ceil(n / (1 << shift));
    // Row-order input, whole words (a short bitmask's missing words read as 0).
    const src = root.createBuffer(d.arrayOf(d.u32, Math.max(1, outWords))).$usage("storage");
    const size = Math.min(rows.byteLength, outWords * 4);
    root.device.queue.writeBuffer(root.unwrap(src), 0, rows.buffer, rows.byteOffset, size);
    gatherParams.write({ shift, offset });
    gatherKernel.with(root.createBindGroup(gatherLayout, { src, dst })).dispatchThreads(outWords);
    src.destroy();
  }
  // Frame.n bounds the gather and bounds kernels; the orchestrator writes the whole frame later.
  frame.patch({ n });
  const xyz = [xBuf, yBuf, zBuf];
  for (let a = 0; a < ndim; a++) gather(root.unwrap(xyz[a]!), positions.subarray(a * n, (a + 1) * n), 0);

  /** World position of point i (z = 0 in 2D). */
  const position = posZ
    ? tgpu.fn(
        [d.u32],
        d.vec3f,
      )((i) => {
        "use gpu";
        return d.vec3f(posX.$[i], posY.$[i], posZ.$[i]);
      })
    : tgpu.fn(
        [d.u32],
        d.vec3f,
      )((i) => {
        "use gpu";
        return d.vec3f(posX.$[i], posY.$[i], 0);
      });

  const boundsRW = boundsBuf.as("mutable");
  root
    .createGuardedComputePipeline((b: number) => {
      "use gpu";
      let lo = d.vec3f(3e38);
      let hi = d.vec3f(-3e38);
      for (let s = b * BATCH; s < std.min((b + 1) * BATCH, frame.$.n); s++) {
        lo = std.min(lo, position(s));
        hi = std.max(hi, position(s));
      }
      boundsRW.$[2 * b] = d.vec4f(lo, 0);
      boundsRW.$[2 * b + 1] = d.vec4f(hi, 0);
    })
    .dispatchThreads(batches);

  const clip = tgpu.fn(
    [d.vec3f],
    d.vec4f,
  )((p) => {
    "use gpu";
    return std.mul(frame.$.viewProj, d.vec4f(p, 1));
  });

  const project = tgpu.fn(
    [d.u32],
    d.vec4f,
  )((i) => {
    "use gpu";
    return clip(position(i));
  });

  const catOf = tgpu.fn(
    [d.u32],
    d.u32,
  )((i) => {
    "use gpu";
    return (cats.$[i >>> 2] >>> ((i & 3) * 8)) & 0xff;
  });

  const layerBit = tgpu.fn(
    [d.u32, d.u32],
    d.u32,
  )((layer, i) => {
    "use gpu";
    return (bitsRO.$[layer * frame.$.words + (i >>> 5)] >>> (i & 31)) & 1;
  });

  /** Bit `c` of category set `which` (0 = isolated, 1 = disabled). */
  const catBit = tgpu.fn(
    [d.u32, d.u32],
    d.u32,
  )((which, c) => {
    "use gpu";
    return (bitsRO.$[LAYERS * frame.$.words + which * 8 + (c >>> 5)] >>> (c & 31)) & 1;
  });

  const on = tgpu.fn(
    [d.u32],
    d.bool,
  )((bit) => {
    "use gpu";
    return ((frame.$.flags >>> bit) & 1) === 1;
  });

  /** Isolation (category · trajectory · continuous range); 1 when no isolation is active. */
  const isoPass = tgpu.fn(
    [d.u32],
    d.u32,
  )((i) => {
    "use gpu";
    if (!on(Bit.isolated) && !on(Bit.trajectory) && !on(Bit.continuous)) return 1;
    const cat = std.select(d.u32(1), catBit(0, catOf(i)), on(Bit.isolated));
    const traj = std.select(d.u32(0), layerBit(Bit.trajectory, i), on(Bit.trajectory));
    const cont = std.select(d.u32(1), layerBit(Bit.continuous, i), on(Bit.continuous));
    return traj | (cat & cont);
  });

  /**
   * Brightness tier: 3 = clicked (ring), 2 = full, 1 = moderate dim, 0 = heavy
   * dim. Isolation and selection (lasso | external) intersect; highlighted
   * points stay bright and push the rest that pass down to moderate.
   */
  const tier = tgpu.fn(
    [d.u32],
    d.u32,
  )((i) => {
    "use gpu";
    const hasSel = on(Bit.lasso) || on(Bit.external);
    const hasIso = on(Bit.isolated) || on(Bit.trajectory) || on(Bit.continuous);
    const hasHi = on(Bit.highlight) || frame.$.clicked !== NONE;
    let selPass = d.u32(1);
    if (hasSel) {
      const lasso = std.select(d.u32(0), layerBit(Bit.lasso, i), on(Bit.lasso));
      const ext = std.select(d.u32(0), layerBit(Bit.external, i), on(Bit.external));
      selPass = lasso | ext;
    }
    const ok = isoPass(i) & selPass;
    if (!hasHi || (!hasIso && !hasSel)) return ok * 2;
    if (i === frame.$.clicked) return 3;
    if (on(Bit.highlight) && layerBit(Bit.highlight, i) === 1) return 2;
    return ok;
  });

  const tierAlpha = tgpu.fn(
    [d.u32],
    d.f32,
  )((t) => {
    "use gpu";
    const dim = frame.$.dim;
    return std.select(std.select(dim, std.clamp(dim * 4, 0, 0.6), t === 1), 1, t >= 2);
  });

  /** Drawn at all: predicate, disabled categories, and (continuous range) hidden tier 0. */
  const visible = tgpu.fn(
    [d.u32, d.u32],
    d.bool,
  )((i, t) => {
    "use gpu";
    if (on(Bit.predicate) && layerBit(Bit.predicate, i) === 0) return false;
    if (on(Bit.disabled) && catBit(1, catOf(i)) === 1) return false;
    return !(on(Bit.hideDimmed) && t === 0);
  });

  /** Palette color by category, or LUT color by normalized value (NaN → mid-gradient). */
  const pointColor = tgpu.fn(
    [d.u32],
    d.vec4f,
  )((i) => {
    "use gpu";
    const f = frame.$;
    if (f.colorBy === 0) return colors.$[catOf(i) % f.paletteLen];
    const v = values.$[i];
    const span = std.max(f.vmax - f.vmin, 1e-20);
    let t = (v - f.vmin) / span;
    // Log only when vmin > 0 and v > 0; otherwise linear.
    if (f.colorBy === 2 && f.vmin > 0 && v > 0) {
      const lo = std.log(f.vmin);
      t = (std.log(v) - lo) / std.max(std.log(std.max(f.vmax, f.vmin * 10)) - lo, 1e-20);
    }
    if (f.colorBy === 3) t = std.sqrt(std.max(v - f.vmin, 0)) / std.max(std.sqrt(span), 1e-20);
    if (v !== v) t = 0.5;
    if (f.reversed === 1) t = 1 - t;
    return colors.$[d.u32(std.clamp(t, 0, 1) * 255)];
  });

  const batchInView = tgpu.fn(
    [d.u32],
    d.bool,
  )((b) => {
    "use gpu";
    const f = frame.$;
    const lo = boundsRO.$[2 * b];
    const hi = boundsRO.$[2 * b + 1];
    // The compaction margin (see render.ts inView): markers near an edge still draw.
    const mx = 1 + (3.2 * f.pointPx) / f.viewport.x;
    const my = 1 + (3.2 * f.pointPx) / f.viewport.y;
    // Corners outside each clip plane: a plane with all 8 outside culls the box.
    let left = d.u32(0);
    let right = d.u32(0);
    let below = d.u32(0);
    let above = d.u32(0);
    let near = d.u32(0);
    let far = d.u32(0);
    for (let k = d.u32(0); k < 8; k++) {
      const corner = d.vec4f(
        std.select(lo.x, hi.x, (k & 1) === 1),
        std.select(lo.y, hi.y, (k & 2) === 2),
        std.select(lo.z, hi.z, (k & 4) === 4),
        1,
      );
      const c = std.mul(f.viewProj, corner);
      left += std.select(d.u32(0), 1, c.x < -mx * c.w);
      right += std.select(d.u32(0), 1, c.x > mx * c.w);
      below += std.select(d.u32(0), 1, c.y < -my * c.w);
      above += std.select(d.u32(0), 1, c.y > my * c.w);
      near += std.select(d.u32(0), 1, c.z < 0);
      far += std.select(d.u32(0), 1, c.z > c.w);
    }
    return left < 8 && right < 8 && below < 8 && above < 8 && near < 8 && far < 8;
  });

  const wordPasses = tgpu.fn(
    [d.u32],
    d.bool,
  )((w) => {
    "use gpu";
    return !on(Bit.predicate) || bitsRO.$[Bit.predicate * frame.$.words + w] !== 0;
  });

  const batchCenter = tgpu.fn(
    [d.u32],
    d.vec4f,
  )((b) => {
    "use gpu";
    const mid = std.mul(std.add(boundsRO.$[2 * b], boundsRO.$[2 * b + 1]), 0.5);
    return std.mul(frame.$.viewProj, d.vec4f(mid.xyz, 1));
  });

  const batchLive = tgpu.fn(
    [d.u32],
    d.bool,
  )((b) => {
    "use gpu";
    if (on(Bit.predicate)) {
      let any = d.u32(0);
      const first = Bit.predicate * frame.$.words + b * 8;
      for (let k = d.u32(0); k < 8; k++) {
        if (b * 8 + k < frame.$.words) any = any | bitsRO.$[first + k];
      }
      if (any === 0) return false;
    }
    return batchInView(b);
  });

  // ── Storage order → row order: each set bit s of the layer sets bit perm[s] of rowBits ──
  const layerParams = root.createUniform(d.u32);
  const rowBitsRW = rowBits.as("mutable");
  const toRowsKernel = root.createGuardedComputePipeline((w: number) => {
    "use gpu";
    const word = bitsRO.$[layerParams.$ * frame.$.words + w];
    for (let k = d.u32(0); k < 32; k++) {
      if (((word >>> k) & 1) === 1) {
        const r = perm.$[w * 32 + k];
        std.atomicOr(rowBitsRW.$[r >>> 5], d.u32(1) << (r & 31));
      }
    }
  });

  const bytes = [xBuf, yBuf, zBuf, catBuf, valueBuf, permBuf, boundsBuf, bits, rowBits, ids]
    .map((b) => (b ? root.unwrap(b).size : 0))
    .reduce((a, b) => a + b, 0);

  return {
    n,
    ndim,
    words,
    batches,
    cap,
    bytes,
    posX,
    posY,
    posZ,
    perm,
    bits,
    ids,
    rowBits,
    frame,
    colors,
    clip,
    project,
    catOf,
    isoPass,
    tier,
    tierAlpha,
    visible,
    pointColor,
    batchInView,
    batchLive,
    batchCenter,
    wordPasses,
    writeCategories(rows) {
      const padded = new Uint8Array(Math.ceil(n / 4) * 4);
      padded.set(rows.subarray(0, n));
      gather(root.unwrap(catBuf), padded, 2);
    },
    writeValues(rows) {
      gather(root.unwrap(valueBuf), rows.subarray(0, n), 0);
    },
    writeLayer(bit, rows) {
      gather(root.unwrap(bits), rows, 5, bit * words);
    },
    layerToRows(bit) {
      rowBits.clear();
      layerParams.write(bit);
      toRowsKernel.dispatchThreads(words);
    },
  };
}
