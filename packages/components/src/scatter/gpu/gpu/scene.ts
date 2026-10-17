import {
  tgpu,
  type StorageFlag,
  type TgpuBuffer,
  type TgpuFn,
  type TgpuReadonly,
  type TgpuSlot,
  type TgpuUniform,
} from "typegpu";
import * as d from "typegpu/data";
import * as std from "typegpu/std";
import type { TgpuRoot } from "../../gpu/types";

/** "No point": the clicked-point sentinel. */
export const NONE = 0xffffffff;

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
  /** Density splat grid: the canvas in device px (a half-res grid quadrupled atomic contention: 4.2 vs 2.5 ms at 10M). */
  grid: d.vec2u,
});
export type FrameState = d.InferInput<typeof Frame>;

type PointFn<R extends d.AnyWgslData> = TgpuFn<(i: d.U32) => R>;
type U32Array = d.WgslArray<d.U32>;
type F32Array = d.WgslArray<d.F32>;

/**
 * The per-view GPU scene: readonly SoA point data, bit layers, the frame
 * uniform, and the TGSL helpers every pass shares, so render, compaction,
 * selection, density, and pick agree by construction.
 */
export interface Scene {
  readonly n: number;
  /** Words per bit layer: ceil(n / 32). */
  readonly words: number;
  /** Capacity of `ids`. */
  readonly cap: number;
  readonly posX: TgpuReadonly<F32Array>;
  readonly posY: TgpuReadonly<F32Array>;
  readonly cats: TgpuReadonly<U32Array>;
  readonly values: TgpuReadonly<F32Array>;
  readonly bits: TgpuBuffer<U32Array> & StorageFlag;
  readonly ids: TgpuBuffer<U32Array> & StorageFlag;
  readonly frame: TgpuUniform<typeof Frame>;
  readonly colors: TgpuUniform<d.WgslArray<d.Vec4f>>;
  /** World position of point i: 2D reads posX/posY with z = 0; P3 binds a 3D variant. */
  readonly worldPos: TgpuSlot<PointFn<d.Vec4f>>;
  /** Clip-space position of point i: `viewProj · worldPos(i)`. */
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
}

export function createScene(root: TgpuRoot, n: number, cap: number): Scene {
  const words = Math.ceil(n / 32);
  const posX = root.createReadonly(d.arrayOf(d.f32, Math.max(1, n)));
  const posY = root.createReadonly(d.arrayOf(d.f32, Math.max(1, n)));
  // Category u8 ×4 per word; continuous values f32.
  const cats = root.createReadonly(d.arrayOf(d.u32, Math.max(1, Math.ceil(n / 4))));
  const values = root.createReadonly(d.arrayOf(d.f32, Math.max(1, n)));
  const bits = root.createBuffer(d.arrayOf(d.u32, LAYERS * words + 16)).$usage("storage");
  const bitsRO = bits.as("readonly");
  // Compacted visible point ids, written by compaction, read by the quad and pick draws.
  const ids = root.createBuffer(d.arrayOf(d.u32, Math.max(1, cap))).$usage("storage");
  const frame = root.createUniform(Frame);
  // Categorical palette (first `paletteLen` entries) or the 256-entry continuous LUT.
  const colors = root.createUniform(d.arrayOf(d.vec4f, 256));

  /** World position of point i. P3 binds a 3D variant (reads posZ) through this slot. */
  const worldPos = tgpu.slot(
    tgpu.fn(
      [d.u32],
      d.vec4f,
    )((i) => {
      "use gpu";
      return d.vec4f(posX.$[i], posY.$[i], 0, 1);
    }),
  );

  /** Clip-space position of point i. */
  const project = tgpu.fn(
    [d.u32],
    d.vec4f,
  )((i) => {
    "use gpu";
    return std.mul(frame.$.viewProj, worldPos.$(i));
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

  return {
    n,
    words,
    cap,
    posX,
    posY,
    cats,
    values,
    bits,
    ids,
    frame,
    colors,
    worldPos,
    project,
    catOf,
    isoPass,
    tier,
    tierAlpha,
    visible,
    pointColor,
  };
}
