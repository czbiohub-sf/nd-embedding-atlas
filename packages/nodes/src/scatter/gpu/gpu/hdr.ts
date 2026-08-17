/**
 * HDR + tone-map pipeline.
 *
 * Pipeline:
 *
 *   scatter (additive blending) → HDR rgba16float
 *   tone map (AgX/ACES/Reinhard/None) + exposure → swap chain (rgba8unorm)
 *
 * Resize-aware. `resize(width, height)` reallocates the HDR target at the
 * new pixel size. Canvas controls dimensions; this module is given physical
 * pixel sizes (DPR-multiplied) by the orchestrator.
 */

import { FULLSCREEN_VERTEX_WGSL, TONEMAP_FRAGMENT_WGSL } from "./hdr-shaders";

/** Tone mapping options exposed to the UI. */
export type ToneMappingMode = "none" | "reinhard" | "aces" | "agx" | "neutral";

const MODE_TO_INT: Record<ToneMappingMode, number> = {
  none: 0,
  reinhard: 1,
  aces: 2,
  agx: 3,
  neutral: 4,
};

/** Settings tuned via the dev-tools "Render" tab. */
export interface HdrSettings {
  /** Tone-map curve. Default `"none"`. */
  toneMapping: ToneMappingMode;
  /** Global exposure stops (log2). 0 = neutral, +1 = 2× brighter. */
  exposure: number;
}

export const DEFAULT_HDR_SETTINGS: HdrSettings = {
  // Khronos Neutral preserves color identity below ~0.76 luminance and only
  // rolls off extreme HDR overdraw: the right default for categorical
  // scatter where bright clusters should glow without bleaching the palette.
  toneMapping: "neutral",
  exposure: 0.0,
};

export interface HdrPipeline {
  /** HDR color attachment view: bind in the scatter render pass. */
  hdrView(): GPUTextureView;
  /** Format the scatter pipeline must declare for its color target. */
  readonly hdrFormat: GPUTextureFormat;
  /**
   * Run tone-map; writes to the swap chain texture provided by `swapView`.
   * Pass an external encoder to merge into the orchestrator's frame submit.
   */
  composite(swapView: GPUTextureView, encoder: GPUCommandEncoder): void;
  /** Recreate the HDR target at new physical-pixel dimensions. */
  resize(width: number, height: number): void;
  /** Update settings: uniform write only, no allocations. */
  setSettings(settings: Partial<HdrSettings>): void;
  getSettings(): HdrSettings;
  destroy(): void;
}

const HDR_FORMAT: GPUTextureFormat = "rgba16float";

interface Targets {
  width: number;
  height: number;
  hdr: GPUTexture;
  hdrView: GPUTextureView;
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
  const tonemapFs = device.createShaderModule({ code: TONEMAP_FRAGMENT_WGSL, label: "hdr-tonemap" });

  // ── Sampler ───────────────────────────────────────────────────────────
  const sampler = device.createSampler({
    label: "hdr-sampler",
    magFilter: "linear",
    minFilter: "linear",
    addressModeU: "clamp-to-edge",
    addressModeV: "clamp-to-edge",
  });

  // ── Tone-map config uniform (16 bytes: f32 + u32 + 8 B padding) ──────
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
    u[1] = MODE_TO_INT[settings.toneMapping];
    device.queue.writeBuffer(toneCfgBuffer, 0, data);
  }
  writeToneCfg();

  // ── Bind group layout ────────────────────────────────────────────────
  const tonemapBgl = device.createBindGroupLayout({
    label: "tonemap-bgl",
    entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
    ],
  });

  // ── Pipeline (created once; texture views rebind per resize) ─────────
  const tonemapPipeline = device.createRenderPipeline({
    label: "tonemap-pipeline",
    layout: device.createPipelineLayout({ bindGroupLayouts: [tonemapBgl] }),
    vertex: { module: vsModule, entryPoint: "main" },
    fragment: { module: tonemapFs, entryPoint: "main", targets: [{ format: swapFormat }] },
    primitive: { topology: "triangle-list" },
  });

  // ── Targets + bind group (reallocated on resize) ─────────────────────
  let targets: Targets | null = null;
  let tonemapBg: GPUBindGroup | null = null;

  function rebuildTargets(width: number, height: number) {
    const w = Math.max(1, Math.floor(width));
    const h = Math.max(1, Math.floor(height));

    targets?.hdr.destroy();

    const hdr = device.createTexture({
      label: "hdr-color",
      size: { width: w, height: h },
      format: HDR_FORMAT,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });

    targets = {
      width: w,
      height: h,
      hdr,
      hdrView: hdr.createView(),
    };

    tonemapBg = device.createBindGroup({
      label: "tonemap-bg",
      layout: tonemapBgl,
      entries: [
        { binding: 0, resource: targets.hdrView },
        { binding: 1, resource: sampler },
        { binding: 2, resource: { buffer: toneCfgBuffer } },
      ],
    });
  }

  rebuildTargets(initialWidth, initialHeight);

  // ── Composite: invoked once per frame after the scatter pass ────────
  function composite(swapView: GPUTextureView, encoder: GPUCommandEncoder): void {
    if (!targets || !tonemapBg) return;

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
      targets = null;
      toneCfgBuffer.destroy();
    },
  };
}
