/**
 * HDR + bloom + tone-map pipeline.
 *
 * Pipeline:
 *
 *   scatter (additive blending) → HDR rgba16float
 *                              → brightpass → bloom mip 0 (half res)
 *                              → 4-tap separable blur (H/V) → bloom mip 0
 *   tone map (AgX/ACES/Reinhard/None) + exposure + bloom composite
 *                              → swap chain (rgba8unorm)
 *
 * One bloom level keeps the implementation tight. Multi-mip can be added
 * later if denser glow is needed; the current shape gives a clear visual
 * lift over rendering directly to the canvas.
 *
 * luxar reference: post-processing-manager.ts + luxar-tone-mapping-effect.ts.
 *
 * Resize-aware. `resize(width, height)` reallocates HDR + bloom textures
 * at the new pixel size. Canvas controls dimensions; this module is given
 * physical pixel sizes (DPR-multiplied) by the orchestrator.
 */

import {
  BLUR_FRAGMENT_WGSL,
  BRIGHTPASS_FRAGMENT_WGSL,
  FULLSCREEN_VERTEX_WGSL,
  TONEMAP_FRAGMENT_WGSL,
} from "./hdr-shaders";

/** Tone mapping options exposed to the UI. */
export type ToneMappingMode = "none" | "reinhard" | "aces" | "agx";

const MODE_TO_INT: Record<ToneMappingMode, number> = {
  none: 0,
  reinhard: 1,
  aces: 2,
  agx: 3,
};

/** Settings tuned via the dev-tools "Render" tab. */
export interface HdrSettings {
  /** Tone-map curve. Default `"agx"`. */
  toneMapping: ToneMappingMode;
  /** Bloom mix amount. 0 = no bloom; 1 = aggressive. Default 0.3. */
  bloomStrength: number;
  /** HDR luminance threshold above which bloom kicks in. Default 1.0. */
  bloomThreshold: number;
  /** Global exposure stops (log2). 0 = neutral, +1 = 2× brighter. */
  exposure: number;
}

export const DEFAULT_HDR_SETTINGS: HdrSettings = {
  toneMapping: "agx",
  bloomStrength: 0.3,
  bloomThreshold: 1.0,
  exposure: 0.0,
};

export interface HdrPipeline {
  /** HDR color attachment view — bind in the scatter render pass. */
  hdrView(): GPUTextureView;
  /** Format the scatter pipeline must declare for its color target. */
  readonly hdrFormat: GPUTextureFormat;
  /**
   * Run brightpass → blur → tone-map; writes to the swap chain texture
   * provided by `swapView`. Pass an external encoder to merge into the
   * orchestrator's frame submit.
   */
  composite(swapView: GPUTextureView, encoder: GPUCommandEncoder): void;
  /** Recreate textures at new physical-pixel dimensions. */
  resize(width: number, height: number): void;
  /** Update settings — uniform write only, no allocations. */
  setSettings(settings: Partial<HdrSettings>): void;
  getSettings(): HdrSettings;
  destroy(): void;
}

const HDR_FORMAT: GPUTextureFormat = "rgba16float";

interface Targets {
  width: number;
  height: number;
  bloomWidth: number;
  bloomHeight: number;
  hdr: GPUTexture;
  hdrView: GPUTextureView;
  bloomA: GPUTexture;
  bloomAView: GPUTextureView;
  bloomB: GPUTexture;
  bloomBView: GPUTextureView;
}

export function createHdrPipeline(
  device: GPUDevice,
  swapFormat: GPUTextureFormat,
  initialWidth: number,
  initialHeight: number,
  initial?: Partial<HdrSettings>,
): HdrPipeline {
  const settings: HdrSettings = { ...DEFAULT_HDR_SETTINGS, ...initial };

  // ── Shader modules ────────────────────────────────────────────────────
  const vsModule = device.createShaderModule({ code: FULLSCREEN_VERTEX_WGSL, label: "hdr-vs" });
  const brightpassFs = device.createShaderModule({ code: BRIGHTPASS_FRAGMENT_WGSL, label: "hdr-brightpass" });
  const blurFs = device.createShaderModule({ code: BLUR_FRAGMENT_WGSL, label: "hdr-blur" });
  const tonemapFs = device.createShaderModule({ code: TONEMAP_FRAGMENT_WGSL, label: "hdr-tonemap" });

  // ── Sampler — bilinear for the bloom blur ────────────────────────────
  const sampler = device.createSampler({
    label: "hdr-sampler",
    magFilter: "linear",
    minFilter: "linear",
    addressModeU: "clamp-to-edge",
    addressModeV: "clamp-to-edge",
  });

  // ── Tone-map config uniform (16 bytes: f32 × 3 + u32) ────────────────
  const toneCfgBuffer = device.createBuffer({
    label: "hdr-tone-cfg",
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  function writeToneCfg() {
    const data = new ArrayBuffer(16);
    const f = new Float32Array(data);
    const u = new Uint32Array(data);
    f[0] = settings.exposure;
    f[1] = settings.bloomStrength;
    f[2] = settings.bloomThreshold;
    u[3] = MODE_TO_INT[settings.toneMapping];
    device.queue.writeBuffer(toneCfgBuffer, 0, data);
  }
  writeToneCfg();

  // ── Blur direction uniforms (two of them — H and V) ──────────────────
  const blurCfgH = device.createBuffer({
    label: "blur-cfg-h",
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const blurCfgV = device.createBuffer({
    label: "blur-cfg-v",
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  // ── Bind group layouts ────────────────────────────────────────────────
  const brightpassBgl = device.createBindGroupLayout({
    label: "brightpass-bgl",
    entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
    ],
  });
  const blurBgl = device.createBindGroupLayout({
    label: "blur-bgl",
    entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
    ],
  });
  const tonemapBgl = device.createBindGroupLayout({
    label: "tonemap-bgl",
    entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
      { binding: 3, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
    ],
  });

  // ── Pipelines (created once; texture views rebind per resize) ────────
  const brightpassPipeline = device.createRenderPipeline({
    label: "brightpass-pipeline",
    layout: device.createPipelineLayout({ bindGroupLayouts: [brightpassBgl] }),
    vertex: { module: vsModule, entryPoint: "main" },
    fragment: { module: brightpassFs, entryPoint: "main", targets: [{ format: HDR_FORMAT }] },
    primitive: { topology: "triangle-list" },
  });

  const blurPipeline = device.createRenderPipeline({
    label: "blur-pipeline",
    layout: device.createPipelineLayout({ bindGroupLayouts: [blurBgl] }),
    vertex: { module: vsModule, entryPoint: "main" },
    fragment: { module: blurFs, entryPoint: "main", targets: [{ format: HDR_FORMAT }] },
    primitive: { topology: "triangle-list" },
  });

  const tonemapPipeline = device.createRenderPipeline({
    label: "tonemap-pipeline",
    layout: device.createPipelineLayout({ bindGroupLayouts: [tonemapBgl] }),
    vertex: { module: vsModule, entryPoint: "main" },
    fragment: { module: tonemapFs, entryPoint: "main", targets: [{ format: swapFormat }] },
    primitive: { topology: "triangle-list" },
  });

  // ── Targets + bind groups (reallocated on resize) ────────────────────
  let targets: Targets | null = null;
  let brightpassBg: GPUBindGroup | null = null;
  let blurHBg: GPUBindGroup | null = null;
  let blurVBg: GPUBindGroup | null = null;
  let tonemapBg: GPUBindGroup | null = null;

  function rebuildTargets(width: number, height: number) {
    const w = Math.max(1, Math.floor(width));
    const h = Math.max(1, Math.floor(height));
    // Bloom at half resolution — saves 4× the fragment cost per blur tap
    // and the blur quality difference is invisible.
    const bw = Math.max(1, Math.floor(w / 2));
    const bh = Math.max(1, Math.floor(h / 2));

    // Tear down previous textures.
    targets?.hdr.destroy();
    targets?.bloomA.destroy();
    targets?.bloomB.destroy();

    const hdr = device.createTexture({
      label: "hdr-color",
      size: { width: w, height: h },
      format: HDR_FORMAT,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    const bloomA = device.createTexture({
      label: "bloom-a",
      size: { width: bw, height: bh },
      format: HDR_FORMAT,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    const bloomB = device.createTexture({
      label: "bloom-b",
      size: { width: bw, height: bh },
      format: HDR_FORMAT,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });

    targets = {
      width: w,
      height: h,
      bloomWidth: bw,
      bloomHeight: bh,
      hdr,
      hdrView: hdr.createView(),
      bloomA,
      bloomAView: bloomA.createView(),
      bloomB,
      bloomBView: bloomB.createView(),
    };

    // Texel offsets for the separable blur in 0..1 UV space.
    const offH = new ArrayBuffer(16);
    const fH = new Float32Array(offH);
    fH[0] = 1 / bw; // texel dx
    fH[1] = 0;
    device.queue.writeBuffer(blurCfgH, 0, offH);
    const offV = new ArrayBuffer(16);
    const fV = new Float32Array(offV);
    fV[0] = 0;
    fV[1] = 1 / bh;
    device.queue.writeBuffer(blurCfgV, 0, offV);

    // Brightpass reads from HDR, writes to bloomA.
    brightpassBg = device.createBindGroup({
      label: "brightpass-bg",
      layout: brightpassBgl,
      entries: [
        { binding: 0, resource: targets.hdrView },
        { binding: 1, resource: sampler },
        { binding: 2, resource: { buffer: toneCfgBuffer } },
      ],
    });
    // Horizontal blur: bloomA → bloomB.
    blurHBg = device.createBindGroup({
      label: "blur-h-bg",
      layout: blurBgl,
      entries: [
        { binding: 0, resource: targets.bloomAView },
        { binding: 1, resource: sampler },
        { binding: 2, resource: { buffer: blurCfgH } },
      ],
    });
    // Vertical blur: bloomB → bloomA.
    blurVBg = device.createBindGroup({
      label: "blur-v-bg",
      layout: blurBgl,
      entries: [
        { binding: 0, resource: targets.bloomBView },
        { binding: 1, resource: sampler },
        { binding: 2, resource: { buffer: blurCfgV } },
      ],
    });
    // Tone map: HDR + final-bloomA → swap chain.
    tonemapBg = device.createBindGroup({
      label: "tonemap-bg",
      layout: tonemapBgl,
      entries: [
        { binding: 0, resource: targets.hdrView },
        { binding: 1, resource: targets.bloomAView },
        { binding: 2, resource: sampler },
        { binding: 3, resource: { buffer: toneCfgBuffer } },
      ],
    });
  }

  rebuildTargets(initialWidth, initialHeight);

  // ── Composite — invoked once per frame after the scatter pass ────────
  function composite(swapView: GPUTextureView, encoder: GPUCommandEncoder): void {
    if (!targets || !brightpassBg || !blurHBg || !blurVBg || !tonemapBg) return;

    // 1. Brightpass — HDR → bloomA
    {
      const pass = encoder.beginRenderPass({
        label: "brightpass",
        colorAttachments: [
          {
            view: targets.bloomAView,
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
            loadOp: "clear",
            storeOp: "store",
          },
        ],
      });
      pass.setPipeline(brightpassPipeline);
      pass.setBindGroup(0, brightpassBg);
      pass.draw(3);
      pass.end();
    }
    // 2a. Horizontal blur — bloomA → bloomB
    {
      const pass = encoder.beginRenderPass({
        label: "blur-h",
        colorAttachments: [
          {
            view: targets.bloomBView,
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
            loadOp: "clear",
            storeOp: "store",
          },
        ],
      });
      pass.setPipeline(blurPipeline);
      pass.setBindGroup(0, blurHBg);
      pass.draw(3);
      pass.end();
    }
    // 2b. Vertical blur — bloomB → bloomA
    {
      const pass = encoder.beginRenderPass({
        label: "blur-v",
        colorAttachments: [
          {
            view: targets.bloomAView,
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
            loadOp: "clear",
            storeOp: "store",
          },
        ],
      });
      pass.setPipeline(blurPipeline);
      pass.setBindGroup(0, blurVBg);
      pass.draw(3);
      pass.end();
    }
    // 3. Tone map — HDR + bloom → swap chain
    {
      const pass = encoder.beginRenderPass({
        label: "tonemap",
        colorAttachments: [
          {
            view: swapView,
            clearValue: { r: 0, g: 0, b: 0, a: 1 },
            loadOp: "clear",
            storeOp: "store",
          },
        ],
      });
      pass.setPipeline(tonemapPipeline);
      pass.setBindGroup(0, tonemapBg);
      pass.draw(3);
      pass.end();
    }
  }

  return {
    hdrView() {
      if (!targets) throw new Error("HDR pipeline not initialized");
      return targets.hdrView;
    },
    hdrFormat: HDR_FORMAT,
    composite,
    resize(width, height) {
      rebuildTargets(width, height);
    },
    setSettings(partial) {
      Object.assign(settings, partial);
      writeToneCfg();
    },
    getSettings() {
      return { ...settings };
    },
    destroy() {
      targets?.hdr.destroy();
      targets?.bloomA.destroy();
      targets?.bloomB.destroy();
      targets = null;
      toneCfgBuffer.destroy();
      blurCfgH.destroy();
      blurCfgV.destroy();
    },
  };
}
