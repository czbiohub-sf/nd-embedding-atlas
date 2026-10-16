import type { TgpuRoot } from "../../gpu/types";
import type { ScatterBuffers } from "./buffers";
import type { CullingEngine } from "./culling";
import type { createFragmentShader, createVertexShader } from "./shaders";

/**
 * Blend modes supported by the scatter pipeline.
 *
 * - `additive`: order-independent. Each premultiplied fragment sums
 *   into the framebuffer; dense regions roll off via the HDR + tone-map
 *   stage. Recommended default.
 * - `premultiplied`: order-dependent classic alpha-over. Preserves
 *   category color identity in dense overlap, but flickers as the GPU
 *   reorders coincident points.
 * - `max`: brightest-fragment-wins via `blendOperation: "max"`. Useful
 *   for max-projection style readouts; never sums color so the result
 *   is bounded to the brightest single point.
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

export function createRenderPipeline(
  root: TgpuRoot,
  mainVertex: ReturnType<typeof createVertexShader>,
  mainFragment: ReturnType<typeof createFragmentShader>,
  buffers: ScatterBuffers,
  culling: CullingEngine,
  /**
   * Format of the color target. With HDR enabled this is `'rgba16float'`
   * (the HDR target); without HDR it is the canvas format (e.g. bgra8unorm).
   */
  format: GPUTextureFormat,
  backgroundColor: [number, number, number, number],
  numPoints: number,
  blendMode: BlendMode = "additive",
) {
  const { quadLayout, posLayout, colorLayout, selectedLayout } = buffers;
  const { visibilityLayout } = culling;

  const pipeline = root.createRenderPipeline({
    attribs: {
      quadPos: quadLayout.attrib,
      instancePos: posLayout.attrib,
      instanceColor: colorLayout.attrib,
      instanceSelected: selectedLayout.attrib,
      instanceVisible: visibilityLayout.attrib,
    },
    vertex: mainVertex,
    fragment: mainFragment,
    targets: {
      format,
      blend: BLEND_MODES[blendMode],
    },
    primitive: { topology: "triangle-list" },
  });

  // Record vertex-buffer bindings + draw once via a raw WebGPU bundle encoder.
  // Uniform buffer CONTENTS can change (viewUniform writes) without invalidating
  // the bundle: only buffer OBJECTS need to stay stable, which they do for the
  // lifetime of a scatter instance.
  const bundleEncoder = root.device.createRenderBundleEncoder({
    colorFormats: [format],
  });
  pipeline
    .with(quadLayout, buffers.quadBuffer)
    .with(posLayout, buffers.posBuffer)
    .with(colorLayout, buffers.colorBuffer)
    .with(selectedLayout, buffers.selectedBuffer)
    .with(visibilityLayout, culling.visibilityBuffer)
    .with(bundleEncoder)
    .draw(6, numPoints);
  const renderBundle = bundleEncoder.finish();

  return {
    /**
     * Render the scatter into a color attachment view. With HDR enabled this
     * is the HDR target; without HDR it would be the canvas's current
     * texture view (`context.getCurrentTexture().createView()`).
     */
    render(
      view: GPUTextureView,
      _numPoints: number,
      loadOp: "clear" | "load" = "clear",
      externalEncoder?: GPUCommandEncoder,
    ) {
      const encoder = externalEncoder ?? root.device.createCommandEncoder();
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view,
            loadOp,
            storeOp: "store",
            ...(loadOp === "clear" ? { clearValue: backgroundColor } : {}),
          },
        ],
      });
      pass.executeBundles([renderBundle]);
      pass.end();
      if (!externalEncoder) root.device.queue.submit([encoder.finish()]);
    },
  };
}

/**
 * Build all three blend-mode variants of the scatter pipeline up front and
 * return a `render(view, numPoints, loadOp, encoder)` that dispatches to
 * the currently-selected one. Pipelines + render bundles are cheap to
 * keep around; switching modes at runtime is a single object lookup, so
 * we avoid the cost of rebuilding (and the latency hitch) on toggle.
 */
export function createBlendableRenderPipelines(
  root: TgpuRoot,
  mainVertex: ReturnType<typeof createVertexShader>,
  mainFragment: ReturnType<typeof createFragmentShader>,
  buffers: ScatterBuffers,
  culling: CullingEngine,
  format: GPUTextureFormat,
  backgroundColor: [number, number, number, number],
  numPoints: number,
  initialBlendMode: BlendMode = "additive",
) {
  const variants: Record<BlendMode, ReturnType<typeof createRenderPipeline>> = {
    additive: createRenderPipeline(
      root,
      mainVertex,
      mainFragment,
      buffers,
      culling,
      format,
      backgroundColor,
      numPoints,
      "additive",
    ),
    premultiplied: createRenderPipeline(
      root,
      mainVertex,
      mainFragment,
      buffers,
      culling,
      format,
      backgroundColor,
      numPoints,
      "premultiplied",
    ),
    max: createRenderPipeline(
      root,
      mainVertex,
      mainFragment,
      buffers,
      culling,
      format,
      backgroundColor,
      numPoints,
      "max",
    ),
  };

  let active: BlendMode = initialBlendMode;

  return {
    render(view: GPUTextureView, n: number, loadOp: "clear" | "load" = "clear", externalEncoder?: GPUCommandEncoder) {
      variants[active].render(view, n, loadOp, externalEncoder);
    },
    setBlendMode(mode: BlendMode) {
      active = mode;
    },
    getBlendMode(): BlendMode {
      return active;
    },
  };
}
