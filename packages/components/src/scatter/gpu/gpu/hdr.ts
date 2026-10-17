/**
 * HDR target + tone-map: points draw additively into an rgba16float target,
 * then one full-screen pass applies exposure and a tone curve (AgX / ACES /
 * Reinhard / Khronos Neutral / none) and encodes sRGB into the canvas.
 */

import { tgpu, type TgpuCommandEncoder } from "typegpu";
import { fullScreenTriangle } from "typegpu/common";
import * as d from "typegpu/data";
import * as std from "typegpu/std";
import type { TgpuRoot } from "../../gpu/types";

export type ToneMappingMode = "none" | "reinhard" | "aces" | "agx" | "neutral";

const MODES: Record<ToneMappingMode, number> = { none: 0, reinhard: 1, aces: 2, agx: 3, neutral: 4 };

export interface HdrSettings {
  /** Default `"neutral"`: identity below ~0.76 luminance, so categorical colors keep their identity. */
  toneMapping: ToneMappingMode;
  /** Exposure stops (log2); 0 = neutral. */
  exposure: number;
}

export const HDR_FORMAT = "rgba16float";

const ToneCfg = d.struct({ exposure: d.f32, mode: d.u32 });

// AgX (Troy Sobotka; public-domain Filament / three.js port): Rec.709 ↔ AgX working space.
const AGX_IN = d.mat3x3f(
  0.842479062253094,
  0.0423282422610123,
  0.0423756549057051,
  0.0784335999999992,
  0.878468636469772,
  0.0784336,
  0.0792237451477643,
  0.0791661274605434,
  0.879142973793104,
);
const AGX_OUT = d.mat3x3f(
  1.19687900512017,
  -0.0980208811401368,
  -0.0990297440797205,
  -0.0528968517574562,
  1.15190312990417,
  -0.0989611768448433,
  -0.0529716355144438,
  -0.0980434501171241,
  1.15107367264116,
);

/** AgX default contrast: 7th-order sigmoid fit over a 16.5-stop log2 encoding (-10 .. 6.5 EV). */
const agxChannel = tgpu.fn(
  [d.f32],
  d.f32,
)((c) => {
  "use gpu";
  const x = std.clamp((std.log2(std.max(c, 1e-10)) + 10) / 16.5, 0, 1);
  const x2 = x * x;
  const x4 = x2 * x2;
  const x6 = x4 * x2;
  return (
    -17.86 * x6 * x + 78.01 * x6 - 126.7 * x4 * x + 92.06 * x4 - 28.72 * x2 * x + 4.361 * x2 - 0.1718 * x + 0.002857
  );
});

const linearToSrgb = tgpu.fn(
  [d.f32],
  d.f32,
)((c) => {
  "use gpu";
  return std.select(1.055 * std.pow(std.max(c, 0), 1 / 2.4) - 0.055, c * 12.92, c < 0.0031308);
});

/** Narkowicz ACES fit. */
const acesChannel = tgpu.fn(
  [d.f32],
  d.f32,
)((c) => {
  "use gpu";
  return std.clamp((c * (2.51 * c + 0.03)) / (c * (2.43 * c + 0.59) + 0.14), 0, 1);
});

/** Khronos PBR Neutral: identity below the knee, then peak roll-off with slight desaturation toward white. */
const neutral = tgpu.fn(
  [d.vec3f],
  d.vec3f,
)((c) => {
  "use gpu";
  const startCompression = 0.76;
  const x = std.min(c.x, std.min(c.y, c.z));
  const offset = std.select(0.04, x - 6.25 * x * x, x < 0.08);
  const color = std.sub(c, d.vec3f(offset));
  const peak = std.max(color.x, std.max(color.y, color.z));
  if (peak < startCompression) return color;
  const dd = 1 - startCompression;
  const newPeak = 1 - (dd * dd) / (peak + dd - startCompression);
  const g = 1 - 1 / (0.15 * (peak - newPeak) + 1);
  return std.mix(std.mul(color, newPeak / peak), d.vec3f(newPeak), g);
});

export interface HdrPipeline {
  /** View of the HDR color target the points draw into (`HDR_FORMAT`). */
  target(): GPUTextureView;
  /** Tone-map the HDR target into the canvas. */
  composite(enc: TgpuCommandEncoder, context: GPUCanvasContext): void;
  /** Reallocate the target at a new device-pixel size. */
  resize(width: number, height: number): void;
  setSettings(settings: Partial<HdrSettings>): void;
  destroy(): void;
}

export function createHdrPipeline(root: TgpuRoot, swapFormat: GPUTextureFormat): HdrPipeline {
  const settings: HdrSettings = { toneMapping: "neutral", exposure: 0 };
  const cfg = root.createUniform(ToneCfg, { exposure: 0, mode: MODES.neutral });
  const layout = tgpu.bindGroupLayout({ hdr: { texture: d.texture2d(d.f32) } });

  const pipeline = root.createRenderPipeline({
    vertex: fullScreenTriangle,
    fragment: tgpu.fragmentFn({ in: { pos: d.builtin.position }, out: d.vec4f })((input) => {
      "use gpu";
      const scene = std.textureLoad(layout.$.hdr, d.vec2i(input.pos.xy), 0);
      const c = std.mul(scene.xyz, std.exp2(cfg.$.exposure));
      const mode = cfg.$.mode;
      let mapped = std.clamp(c, d.vec3f(0), d.vec3f(1));
      if (mode === 1) mapped = std.div(c, std.add(d.vec3f(1), c));
      if (mode === 2) mapped = d.vec3f(acesChannel(c.x), acesChannel(c.y), acesChannel(c.z));
      if (mode === 3) {
        const v = std.mul(AGX_IN, std.max(c, d.vec3f(0)));
        mapped = std.clamp(
          std.mul(AGX_OUT, d.vec3f(agxChannel(v.x), agxChannel(v.y), agxChannel(v.z))),
          d.vec3f(0),
          d.vec3f(1),
        );
      }
      if (mode === 4) mapped = neutral(c);
      // Alpha passes through so the CSS background shows where nothing drew.
      return d.vec4f(linearToSrgb(mapped.x), linearToSrgb(mapped.y), linearToSrgb(mapped.z), std.clamp(scene.w, 0, 1));
    }),
    targets: { format: swapFormat },
  });

  function allocate(size: [number, number]) {
    const texture = root.createTexture({ size, format: HDR_FORMAT }).$usage("render", "sampled");
    return { texture, view: root.unwrap(texture).createView(), group: root.createBindGroup(layout, { hdr: texture }) };
  }
  let target = allocate([1, 1]);

  return {
    target: () => target.view,
    composite(enc, context) {
      pipeline
        .with(target.group)
        .withColorAttachment({ view: context, clearValue: [0, 0, 0, 1] })
        .with(enc)
        .draw(3);
    },
    resize(width, height) {
      target.texture.destroy();
      target = allocate([Math.max(1, width), Math.max(1, height)]);
    },
    setSettings(partial) {
      Object.assign(settings, partial);
      cfg.write({ exposure: settings.exposure, mode: MODES[settings.toneMapping] });
    },
    destroy() {
      target.texture.destroy();
    },
  };
}
