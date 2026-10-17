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
   * Select every visible point whose projection falls inside the painted shape:
   * writes the lasso bit layer and reports the count; `final` (pointer-up) also
   * reports the bit layer (N/32 words). The frame uniform must be current.
   */
  run(paint: PaintShape, width: number, height: number, final: boolean): void;
  /** Drop readbacks requested before now. */
  clear(): void;
  destroy(): void;
}

/**
 * Lasso and marquee alike: the shape is rasterized into a mask texture at the
 * overlay's CSS resolution and each point does one `textureLoad` at its
 * projected position, so the cost is O(1) per point at any vertex count, in
 * 2D or 3D. One thread owns one 32-point word.
 */
export function createSelectionEngine(
  root: TgpuRoot,
  scene: Scene,
  onChange: (count: number, bits?: Uint32Array<ArrayBuffer>) => void,
): SelectionEngine {
  const { frame, project, catOf, words } = scene;
  const device = root.device;
  const bitsRW = scene.bits.as("mutable");
  const count = root.createMutable(d.atomic(d.u32));
  const maskLayout = tgpu.bindGroupLayout({ mask: { texture: d.texture2d(d.f32) } });

  const kernel = root.createGuardedComputePipeline((w: number) => {
    "use gpu";
    const f = frame.$;
    const dims = std.textureDimensions(maskLayout.$.mask);
    const filtered = ((f.flags >>> Bit.predicate) & 1) === 1;
    const disabled = ((f.flags >>> Bit.disabled) & 1) === 1;
    const pred = bitsRW.$[Bit.predicate * f.words + w];
    let out = d.u32(0);
    for (let k = d.u32(0); k < 32; k++) {
      const i = w * 32 + k;
      if (i >= f.n) break;
      if (filtered && ((pred >>> k) & 1) === 0) continue;
      const cat = catOf(i);
      if (disabled && ((bitsRW.$[LAYERS * f.words + 8 + (cat >>> 5)] >>> (cat & 31)) & 1) === 1) continue;
      const c = project(i);
      if (c.w <= 0 || std.abs(c.x) >= c.w || std.abs(c.y) >= c.w) continue;
      const px = d.vec2i(
        d.i32(((c.x / c.w) * 0.5 + 0.5) * d.f32(dims.x)),
        d.i32((0.5 - (c.y / c.w) * 0.5) * d.f32(dims.y)),
      );
      if (std.textureLoad(maskLayout.$.mask, px, 0).x > 0.5) out = out | (d.u32(1) << k);
    }
    bitsRW.$[Bit.lasso * f.words + w] = out;
    std.atomicAdd(count.$, std.countOneBits(out));
  });

  const canvas = new OffscreenCanvas(1, 1);
  const ctx = canvas.getContext("2d", { willReadFrequently: false })!;
  let mask: { texture: ReturnType<typeof makeMask>; group: ReturnType<typeof makeGroup> } | null = null;
  function makeMask(width: number, height: number) {
    return root.createTexture({ size: [width, height], format: "r8unorm" }).$usage("sampled", "render");
  }
  function makeGroup(texture: ReturnType<typeof makeMask>) {
    return root.createBindGroup(maskLayout, { mask: texture });
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
    if (final) encoder.copyBufferToBuffer(root.unwrap(scene.bits), Bit.lasso * words * 4, bitsStaging, 0, words * 4);
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

  return {
    run(paint, width, height, final) {
      width = Math.max(1, Math.round(width));
      height = Math.max(1, Math.round(height));
      if (canvas.width !== width || canvas.height !== height || !mask) {
        canvas.width = width;
        canvas.height = height;
        mask?.texture.destroy();
        const texture = makeMask(width, height);
        mask = { texture, group: makeGroup(texture) };
      }
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = "#fff";
      paint(ctx);
      // Premultiplied: an anti-aliased edge texel reads its coverage, not full white.
      mask.texture.write(canvas, { premultipliedAlpha: true });
      count.write(0);
      kernel.with(mask.group).dispatchThreads(words);
      readback({ final, gen: generation });
    },
    clear() {
      generation++;
    },
    destroy() {
      generation++;
      mask?.texture.destroy();
      countStaging.destroy();
      bitsStaging.destroy();
    },
  };
}
