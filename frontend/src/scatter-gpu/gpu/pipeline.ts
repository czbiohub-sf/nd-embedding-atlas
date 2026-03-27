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

  return {
    render(context: GPUCanvasContext, numPoints: number, loadOp: "clear" | "load" = "clear") {
      pipeline
        .with(quadLayout, buffers.quadBuffer)
        .with(posLayout, buffers.posBuffer)
        .with(colorLayout, buffers.colorBuffer)
        .with(selectedLayout, buffers.selectedBuffer)
        .with(visibilityLayout, culling.visibilityBuffer)
        .withColorAttachment({
          view: context.getCurrentTexture().createView(),
          ...(loadOp === "clear" ? { clearValue: backgroundColor } : {}),
          loadOp: loadOp as "clear" | "load",
          storeOp: "store" as "store",
        })
        .draw(6, numPoints);
    },
  };
}
