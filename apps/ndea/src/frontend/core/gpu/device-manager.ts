export type DeviceInfo = {
  device: GPUDevice;
  format: GPUTextureFormat;
  preferredWorkgroupSize: 64 | 256;
};

let _shared: DeviceInfo | null = null;
let _initPromise: Promise<DeviceInfo> | null = null;
let _refCount = 0;

/** Listeners notified on a genuine (non-`destroyed`) device loss. */
const lossListeners = new Set<(info: GPUDeviceLostInfo) => void>();

/**
 * Subscribe to genuine GPU device loss (driver TDR, GPU reset): NOT our own
 * `device.destroy()` on the last release. Returns an unsubscribe. Hosts use this
 * to surface a "reload to restore" overlay instead of a silently dead canvas.
 */
export function onDeviceLost(cb: (info: GPUDeviceLostInfo) => void): () => void {
  lossListeners.add(cb);
  return () => {
    lossListeners.delete(cb);
  };
}

/**
 * Acquire the shared WebGPU device, refcounted across all scatter instances.
 *
 * Abort and error paths undo their own increment because the caller never
 * receives a handle. Successful callers own the matching `releaseDevice()`.
 */
export async function acquireDevice(signal?: AbortSignal): Promise<DeviceInfo> {
  if (signal?.aborted) throw new DOMException("device acquire aborted", "AbortError");

  _refCount++;
  if (_shared) return _shared;

  _initPromise ??= (async () => {
    if (!navigator.gpu) {
      throw new Error(
        "WebGPU is not supported in this browser. " +
          "If you are on HPC, enable Vulkan flags in chrome://flags: see docs/webgpu-hpc-setup.md for details.",
      );
    }
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
    if (!adapter) {
      throw new Error(
        "No WebGPU adapter found. " +
          "If you are on HPC, enable #enable-vulkan, #default-angle-vulkan, #vulkan-from-angle, and #enable-unsafe-webgpu in chrome://flags, then relaunch Chrome.",
      );
    }
    const adapterInfo = (adapter as { info?: { vendor?: string } }).info;
    const vendor = (adapterInfo?.vendor ?? "").toLowerCase();
    const preferredWorkgroupSize: 64 | 256 = vendor.includes("apple") ? 64 : 256;
    const device = await adapter.requestDevice({
      requiredFeatures: adapter.features.has("timestamp-query") ? ["timestamp-query"] : [],
    });
    // A genuine device loss otherwise silently bricks every scatter panel.
    // `reason === "destroyed"` is our own `device.destroy()` on the last release.
    void device.lost.then((lost) => {
      if (lost.reason === "destroyed") return;
      console.error(`[gpu] device lost (${lost.reason}): ${lost.message}`);
      for (const cb of lossListeners) cb(lost);
    });
    device.onuncapturederror = (event) => {
      console.error("[gpu] uncaptured error:", event.error);
    };
    const format = navigator.gpu.getPreferredCanvasFormat();
    return { device, format, preferredWorkgroupSize };
  })();

  let info: DeviceInfo;
  try {
    info = await _initPromise;
  } catch (e) {
    undoAcquire();
    throw e;
  }

  // Torn down (signal) or every holder released while init was pending → do not
  // strand the device. Destroy it now if we were the last holder.
  if (signal?.aborted || _refCount === 0) {
    undoAcquire(info);
    throw new DOMException("device acquire aborted", "AbortError");
  }

  _shared = info;
  return _shared;
}

/** Undo a single in-flight acquisition's increment; destroy if it was the last. */
function undoAcquire(pendingInfo?: DeviceInfo): void {
  _refCount = Math.max(0, _refCount - 1);
  if (_refCount > 0) return;
  if (_shared) {
    _shared.device.destroy();
    _shared = null;
  } else if (pendingInfo) {
    pendingInfo.device.destroy();
  }
  _initPromise = null;
}

export function releaseDevice(): void {
  _refCount = Math.max(0, _refCount - 1);
  if (_refCount === 0 && _shared) {
    _shared.device.destroy();
    _shared = null;
    _initPromise = null;
  }
}

export function deviceRefCount(): number {
  return _refCount;
}

// Browser diagnostic for leak checks.
if (import.meta.env.DEV && typeof window !== "undefined") {
  (window as unknown as { __ndeaDeviceRefCount?: () => number }).__ndeaDeviceRefCount = deviceRefCount;
}
