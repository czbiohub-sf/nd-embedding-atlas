import { tgpu } from "typegpu";
import type { DeviceInfo } from "./device-manager";

export function initGPU(canvas: HTMLCanvasElement, deviceInfo: DeviceInfo) {
  const { device, format, preferredWorkgroupSize } = deviceInfo;

  const root = tgpu.initFromDevice({ device });
  const context = canvas.getContext("webgpu")!;
  context.configure({ device, format, alphaMode: "premultiplied" });

  const limits = device.limits;
  console.log(
    `GPU workgroupSize: ${preferredWorkgroupSize}. ` +
      `Limits: maxSizeX=${limits.maxComputeWorkgroupSizeX}, maxInvocations=${limits.maxComputeInvocationsPerWorkgroup}`,
  );

  return { root, device, context, format, preferredWorkgroupSize };
}

export type GPUContext = Awaited<ReturnType<typeof initGPU>>;
