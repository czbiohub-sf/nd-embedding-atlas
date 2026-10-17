import { tgpu, type TgpuCommandEncoder } from "typegpu";
import { fullScreenTriangle } from "typegpu/common";
import * as d from "typegpu/data";
import * as std from "typegpu/std";
import type { TgpuRoot } from "../../gpu/types";
import type { Scene } from "./scene";

/**
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

// Byte offsets of the indirect records: quad draw, pick draw, density resolve draw, splat dispatch.
const QUAD = 0;
const PICK = 16;
const RESOLVE = 32;
const SPLAT = 48;
const PICK_WINDOW = 5;

export interface RenderPasses {
  /**
   * Compact in-view visible point ids and write every indirect record (and the
   * quads-vs-density choice). Record it when the camera, a filter, or the data changed.
   */
  compact(enc: TgpuCommandEncoder): void;
  /** Draw the points (quads or density, chosen on the GPU) into the HDR `target`. */
  draw(enc: TgpuCommandEncoder, target: GPUTextureView): void;
  /**
   * Point under device pixel (x, y): the visible id nearest the center of a 5×5
   * window, or null. `compactFirst` when compaction is stale.
   */
  pick(x: number, y: number, compactFirst: boolean): Promise<number | null>;
  setBlendMode(mode: BlendMode): void;
  /** Canvas size changed (device px): reallocates the density grid when density can engage. */
  resize(width: number, height: number, densityPossible: boolean): void;
  destroy(): void;
}

export function createRenderPasses(root: TgpuRoot, scene: Scene, hdrFormat: GPUTextureFormat): RenderPasses {
  const { frame, project, tier, tierAlpha, visible, isoPass, pointColor } = scene;
  const idsRW = scene.ids.as("mutable");
  const idsRO = scene.ids.as("readonly");
  const indirect = root
    .createBuffer(d.arrayOf(d.u32, 16), new Uint32Array([6, 0, 0, 0, 6, 0, 0, 0, 3, 0, 0, 0, 0, 1, 1, 0]))
    .$usage("storage", "indirect");
  const indirectRW = indirect.as("mutable");
  const state = root.createMutable(d.struct({ count: d.atomic(d.u32), dense: d.u32, visible: d.u32 }));

  // ── Compaction: in view ∧ visible → ids; then one thread writes the indirect records ──
  const inView = tgpu.fn(
    [d.vec4f],
    d.bool,
  )((c) => {
    "use gpu";
    // Margin: the clicked ring is 1.6× the marker; ×2 turns px into NDC.
    const mx = (1 + (3.2 * frame.$.pointPx) / frame.$.viewport.x) * c.w;
    const my = (1 + (3.2 * frame.$.pointPx) / frame.$.viewport.y) * c.w;
    return c.w > 0 && std.abs(c.x) <= mx && std.abs(c.y) <= my;
  });

  const compactPipeline = root.createComputePipeline({
    compute: tgpu.computeFn({ workgroupSize: [64], in: { gid: d.builtin.globalInvocationId } })((input) => {
      "use gpu";
      const f = frame.$;
      const w = input.gid.x;
      if (w >= f.words) return;
      let mask = d.u32(0);
      for (let k = d.u32(0); k < 32; k++) {
        const i = w * 32 + k;
        if (i >= f.n) break;
        if (inView(project(i)) && visible(i, tier(i))) mask = mask | (d.u32(1) << k);
      }
      if (mask === 0) return;
      let slot = std.atomicAdd(state.$.count, std.countOneBits(mask));
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
      let dense = state.$.dense;
      if (count > f.cap || count > f.densityHi) dense = 1;
      else if (count < f.densityLo) dense = 0;
      state.$.dense = dense;
      state.$.visible = count;
      const shown = std.min(count, f.cap);
      indirectRW.$[1] = std.select(shown, d.u32(0), dense === 1);
      indirectRW.$[5] = shown;
      indirectRW.$[9] = dense;
      // One thread per point: up to 32768 workgroups of 256 across x, rows of those across y.
      const groups = (f.n + 255) >>> 8;
      indirectRW.$[12] = std.select(d.u32(0), std.min(groups, 32768), dense === 1);
      indirectRW.$[13] = (groups + 32767) >>> 15;
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
    const vi = input.vi;
    // Two triangles: (-1,-1) (1,-1) (-1,1) | (-1,1) (1,-1) (1,1).
    const uv = d.vec2f(
      std.select(d.f32(-1), d.f32(1), vi === 1 || vi >= 4),
      std.select(d.f32(-1), d.f32(1), vi === 2 || vi === 3 || vi === 5),
    );
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

  const quadPipeline = (blend: GPUBlendState) =>
    root.createRenderPipeline({
      vertex: quadVertex,
      fragment: quadFragment,
      targets: { format: hdrFormat, blend },
    });
  const quads: Record<BlendMode, ReturnType<typeof quadPipeline>> = {
    additive: quadPipeline(BLEND_MODES.additive),
    premultiplied: quadPipeline(BLEND_MODES.premultiplied),
    max: quadPipeline(BLEND_MODES.max),
  };
  let blendMode: BlendMode = "additive";

  // ── Density LOD: per-pixel atomic weight + color sums (one thread per point), then a resolve ──
  const accLayout = tgpu.bindGroupLayout({
    acc: { storage: (len: number) => d.arrayOf(d.atomic(d.u32), len), access: "mutable" },
  });

  const splatPipeline = root.createComputePipeline({
    compute: tgpu.computeFn({ workgroupSize: [256], in: { gid: d.builtin.globalInvocationId } })((input) => {
      "use gpu";
      const f = frame.$;
      const i = input.gid.y * (32768 * 256) + input.gid.x;
      if (i >= f.n) return;
      const c = project(i);
      if (c.w <= 0 || std.abs(c.x) >= c.w || std.abs(c.y) >= c.w) return;
      const t = tier(i);
      if (!visible(i, t)) return;
      const color = pointColor(i);
      const weight = color.w * tierAlpha(t) * 255;
      const gx = std.min(d.u32(((c.x / c.w) * 0.5 + 0.5) * d.f32(f.grid.x)), f.grid.x - 1);
      const gy = std.min(d.u32((0.5 - (c.y / c.w) * 0.5) * d.f32(f.grid.y)), f.grid.y - 1);
      const o = (gy * f.grid.x + gx) * 4;
      std.atomicAdd(accLayout.$.acc[o], d.u32(weight));
      std.atomicAdd(accLayout.$.acc[o + 1], d.u32(color.x * weight));
      std.atomicAdd(accLayout.$.acc[o + 2], d.u32(color.y * weight));
      std.atomicAdd(accLayout.$.acc[o + 3], d.u32(color.z * weight));
    }),
  });

  // Average color of the cell, coverage 1 − e^(−weight·opacity): hue survives any density.
  const resolvePipeline = root.createRenderPipeline({
    vertex: fullScreenTriangle,
    fragment: tgpu.fragmentFn({ in: { pos: d.builtin.position }, out: d.vec4f })((input) => {
      "use gpu";
      const f = frame.$;
      const o = (d.u32(input.pos.y) * f.grid.x + d.u32(input.pos.x)) * 4;
      const w = d.f32(std.atomicLoad(accLayout.$.acc[o]));
      if (w === 0) std.discard();
      const a = 1 - std.exp((-w / 255) * f.opacity);
      const k = a / w;
      return d.vec4f(
        d.f32(std.atomicLoad(accLayout.$.acc[o + 1])) * k,
        d.f32(std.atomicLoad(accLayout.$.acc[o + 2])) * k,
        d.f32(std.atomicLoad(accLayout.$.acc[o + 3])) * k,
        a,
      );
    }),
    targets: { format: hdrFormat },
  });

  function makeAcc(len: number) {
    const buffer = root.createBuffer(d.arrayOf(d.atomic(d.u32), len)).$usage("storage");
    return { buffer, group: root.createBindGroup(accLayout, { acc: buffer }) };
  }
  let acc: ReturnType<typeof makeAcc> | null = null;

  // ── Pick: r32uint ids through the same vertex function, scissored to 5×5 ──
  const pickPipeline = root.createRenderPipeline({
    vertex: quadVertex,
    fragment: tgpu.fragmentFn({ in: { uv: d.vec2f, id: d.interpolate("flat", d.u32) }, out: d.vec4u })((input) => {
      "use gpu";
      // Isolation-dimmed points are not clickable.
      if (std.length(input.uv) > 1 || isoPass(input.id) === 0) std.discard();
      return d.vec4u(input.id + 1, 0, 0, 0);
    }),
    targets: { format: "r32uint" },
  });
  // 5 rows at the 256-byte row pitch copyTextureToBuffer requires; 25 ids are read.
  const pickStaging = root.device.createBuffer({
    size: 256 * (PICK_WINDOW - 1) + 4 * PICK_WINDOW,
    usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
  });
  // Allocated on the first click after each resize.
  let size: [number, number] = [1, 1];
  let idTarget: ReturnType<typeof makeIdTarget> | null = null;
  function makeIdTarget() {
    return root.createTexture({ size, format: "r32uint" }).$usage("render");
  }
  let pickChain: Promise<unknown> = Promise.resolve();

  function compact(enc: TgpuCommandEncoder) {
    const pass = enc.beginComputePass();
    compactPipeline.with(pass).dispatchWorkgroups(Math.ceil(scene.words / 64));
    finalizePipeline.with(pass).dispatchWorkgroups(1);
    pass.end();
  }

  return {
    compact,
    draw(enc, target) {
      if (acc) {
        root.unwrap(enc).clearBuffer(root.unwrap(acc.buffer));
        const pass = enc.beginComputePass();
        splatPipeline.with(pass).with(acc.group).dispatchWorkgroupsIndirect(indirect, SPLAT);
        pass.end();
      }
      const pass = enc.beginRenderPass({ colorAttachments: [{ view: target, clearValue: [0, 0, 0, 0] }] });
      quads[blendMode].with(pass).drawIndirect(indirect, QUAD);
      if (acc) resolvePipeline.with(pass).with(acc.group).drawIndirect(indirect, RESOLVE);
      pass.end();
    },
    pick(x, y, compactFirst) {
      const job = pickChain.then(async () => {
        const enc = root["~unstable"].createCommandEncoder();
        if (compactFirst) compact(enc);
        idTarget ??= makeIdTarget();
        const target = idTarget;
        const x0 = Math.max(0, Math.min(Math.floor(x) - 2, size[0] - PICK_WINDOW));
        const y0 = Math.max(0, Math.min(Math.floor(y) - 2, size[1] - PICK_WINDOW));
        const pass = enc.beginRenderPass({ colorAttachments: [{ view: target, clearValue: [0, 0, 0, 0] }] });
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
        await pickStaging.mapAsync(GPUMapMode.READ);
        const words = new Uint32Array(pickStaging.getMappedRange());
        // Nearest hit to the cursor wins.
        let best: number | null = null;
        let bestDist = Infinity;
        for (let row = 0; row < PICK_WINDOW; row++) {
          for (let col = 0; col < PICK_WINDOW; col++) {
            const id = words[row * 64 + col];
            const dist = (x0 + col - x) ** 2 + (y0 + row - y) ** 2;
            if (id !== 0 && dist < bestDist) {
              best = id - 1;
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
    resize(width, height, densityPossible) {
      size = [width, height];
      idTarget?.destroy();
      idTarget = null;
      acc?.buffer.destroy();
      acc = densityPossible ? makeAcc(width * height * 4) : null;
    },
    destroy() {
      idTarget?.destroy();
      pickStaging.destroy();
    },
  };
}
