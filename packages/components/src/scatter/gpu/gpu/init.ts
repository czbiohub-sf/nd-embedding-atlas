import { tgpu } from "typegpu";
import type { DeviceInfo } from "@ndea/sdk";

export function initGPU(canvas: HTMLCanvasElement, deviceInfo: DeviceInfo) {
  const { device, format } = deviceInfo;
  const root = tgpu.initFromDevice({ device });
  const context = canvas.getContext("webgpu")!;
  context.configure({ device, format, alphaMode: "premultiplied" });
  return { root, device, context, format };
}
