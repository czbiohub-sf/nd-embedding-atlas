import tgpu from "typegpu";

export async function initGPU(canvas: HTMLCanvasElement) {
  // Detect GPU vendor before device creation so we can tune workgroup sizes.
  // GPUAdapter.info is available in Chrome 121+ / Firefox 130+.
  const adapter = await navigator.gpu.requestAdapter();
  const vendor = ((adapter as { info?: { vendor?: string } } | null)?.info?.vendor ?? "").toLowerCase();
  // Apple Silicon (M-series) GPUs have a warp/SIMD size of 32 threads per core,
  // making 64-thread workgroups the optimal occupancy sweet spot.
  // NVIDIA and AMD are better served by 256.
  const preferredWorkgroupSize: 64 | 256 = vendor.includes("apple") ? 64 : 256;

  const root = await tgpu.init({
    device: { optionalFeatures: ["timestamp-query"] },
  });
  const device = root.device;
  const context = canvas.getContext("webgpu")!;
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: "premultiplied" });

  const limits = device.limits;
  console.log(
    `GPU vendor: "${vendor || "unknown"}", workgroupSize: ${preferredWorkgroupSize}. ` +
    `Limits: maxSizeX=${limits.maxComputeWorkgroupSizeX}, maxInvocations=${limits.maxComputeInvocationsPerWorkgroup}`,
  );

  return { root, device, context, format, preferredWorkgroupSize };
}

export type GPUContext = Awaited<ReturnType<typeof initGPU>>;
