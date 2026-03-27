import tgpu from "typegpu";

export async function initGPU(canvas: HTMLCanvasElement) {
  const root = await tgpu.init({
    device: { optionalFeatures: ["timestamp-query"] },
  });
  const device = root.device;
  const context = canvas.getContext("webgpu")!;
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: "premultiplied" });

  const limits = device.limits;
  console.log(
    `GPU workgroup limits: maxSizeX=${limits.maxComputeWorkgroupSizeX}, maxInvocations=${limits.maxComputeInvocationsPerWorkgroup}, maxWorkgroups=${limits.maxComputeWorkgroupsPerDimension}`,
  );

  return { root, device, context, format };
}

export type GPUContext = Awaited<ReturnType<typeof initGPU>>;
