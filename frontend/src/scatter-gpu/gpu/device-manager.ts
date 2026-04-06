export type DeviceInfo = {
  device: GPUDevice;
  format: GPUTextureFormat;
  preferredWorkgroupSize: 64 | 256;
};

let _shared: DeviceInfo | null = null;
let _initPromise: Promise<DeviceInfo> | null = null;
let _refCount = 0;

export async function acquireDevice(): Promise<DeviceInfo> {
  _refCount++;
  if (_shared) return _shared;
  if (_initPromise) return _initPromise;
  _initPromise = (async () => {
    if (!navigator.gpu) {
      throw new Error(
        "WebGPU is not supported in this browser. " +
          "If you are on HPC, enable Vulkan flags in chrome://flags — see docs/webgpu-hpc-setup.md for details.",
      );
    }
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
    if (!adapter) {
      throw new Error(
        "No WebGPU adapter found. " +
          "If you are on HPC, enable #enable-vulkan, #default-angle-vulkan, #vulkan-from-angle, and #enable-unsafe-webgpu in chrome://flags, then relaunch Chrome.",
      );
    }
    const vendor = ((adapter as any).info?.vendor ?? "").toLowerCase();
    const preferredWorkgroupSize: 64 | 256 = vendor.includes("apple") ? 64 : 256;
    const device = await adapter.requestDevice({
      requiredFeatures: adapter.features.has("timestamp-query") ? ["timestamp-query"] : [],
    });
    const format = navigator.gpu.getPreferredCanvasFormat();
    _shared = { device, format, preferredWorkgroupSize };
    return _shared;
  })();
  const result = await _initPromise;
  _shared = result;
  return result;
}

export function releaseDevice(): void {
  _refCount = Math.max(0, _refCount - 1);
  if (_refCount === 0 && _shared) {
    _shared.device.destroy();
    _shared = null;
    _initPromise = null;
  }
}
