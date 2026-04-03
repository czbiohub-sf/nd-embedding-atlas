import type { TgpuRoot } from "../types";
import type { ScatterBuffers } from "./buffers";
import type { CullingEngine } from "./culling";
import type { createFragmentShader, createVertexShader } from "./shaders";

export function createRenderPipeline(
  root: TgpuRoot,
  mainVertex: ReturnType<typeof createVertexShader>,
  mainFragment: ReturnType<typeof createFragmentShader>,
  buffers: ScatterBuffers,
  culling: CullingEngine,
  format: GPUTextureFormat,
  backgroundColor: [number, number, number, number],
  numPoints: number,
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
      blend: {
        color: { srcFactor: "one", dstFactor: "one-minus-src-alpha" },
        alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha" },
      },
    },
    primitive: { topology: "triangle-list" },
  });

  // Record vertex-buffer bindings + draw once via a raw WebGPU bundle encoder.
  // Uniform buffer CONTENTS can change (viewUniform writes) without invalidating
  // the bundle — only buffer OBJECTS need to stay stable, which they do for the
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
    render(context: GPUCanvasContext, _numPoints: number, loadOp: "clear" | "load" = "clear") {
      // Raw WebGPU render pass — avoids ~unstable beginRenderPass while still
      // supporting render bundles (which have no stable TypeGPU equivalent yet).
      const encoder = root.device.createCommandEncoder();
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: context.getCurrentTexture().createView(),
            loadOp,
            storeOp: "store",
            ...(loadOp === "clear" ? { clearValue: backgroundColor } : {}),
          },
        ],
      });
      pass.executeBundles([renderBundle]);
      pass.end();
      root.device.queue.submit([encoder.finish()]);
    },
  };
}
