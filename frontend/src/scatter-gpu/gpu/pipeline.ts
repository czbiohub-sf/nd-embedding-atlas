import type { TgpuRoot } from "../types";
import type { ScatterBuffers } from "./buffers";
import type { CullingEngine } from "./culling";

export function createRenderPipeline(
  root: TgpuRoot,
  mainVertex: ReturnType<typeof import("./shaders").createVertexShader>,
  mainFragment: ReturnType<typeof import("./shaders").createFragmentShader>,
  buffers: ScatterBuffers,
  culling: CullingEngine,
  format: GPUTextureFormat,
  backgroundColor: [number, number, number, number],
  numPoints: number,
) {
  const { quadLayout, posLayout, colorLayout, selectedLayout } = buffers;
  const { visibilityLayout } = culling;

  const pipeline = root["~unstable"]
    .withVertex(mainVertex, {
      quadPos: quadLayout.attrib,
      instancePos: posLayout.attrib,
      instanceColor: colorLayout.attrib,
      instanceSelected: selectedLayout.attrib,
      instanceVisible: visibilityLayout.attrib,
    })
    .withFragment(mainFragment, {
      format,
      blend: {
        color: { srcFactor: "one", dstFactor: "one-minus-src-alpha" },
        alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha" },
      },
    })
    .withPrimitive({ topology: "triangle-list" })
    .createPipeline();

  // Record vertex-buffer bindings + draw once via a raw WebGPU bundle encoder.
  // pipeline.with(GPURenderBundleEncoder) captures pipeline state, all vertex
  // buffers, and the uniform bind groups into the bundle.
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
      root["~unstable"].beginRenderPass(
        {
          colorAttachments: [
            {
              view: context.getCurrentTexture().createView(),
              loadOp,
              storeOp: "store",
              ...(loadOp === "clear" ? { clearValue: backgroundColor } : {}),
            },
          ],
        },
        (pass) => {
          pass.executeBundles([renderBundle]);
        },
      );
    },
  };
}
