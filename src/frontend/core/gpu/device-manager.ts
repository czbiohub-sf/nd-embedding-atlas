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
 * Subscribe to genuine GPU device loss (driver TDR, GPU reset) — NOT our own
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
 * AbortSignal-aware (PLUGIN-ARCHITECTURE §7.2): if the caller is torn down while
 * device init is still in flight, passing an aborted (or abort-during-init)
 * signal makes this acquisition undo its own refcount increment and destroy the
 * device the instant it resolves if it was the last holder — so a node added
 * then deleted before init resolves can never strand a live, ownerless device.
 *
 * On the abort/error path the increment is undone HERE (the caller will not get
 * a handle, so it will not call `releaseDevice`). On the success path the caller
 * owns the matching `releaseDevice()`.
 */
export async function acquireDevice(signal?: AbortSignal): Promise<DeviceInfo> {
  if (signal?.aborted) throw new DOMException("device acquire aborted", "AbortError");

  _refCount++;
  if (_shared) return _shared;

  _initPromise ??= (async () => {
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

/** Live acquisitions — the truthful count the DeviceBroker exposes to openPlugin. */
export function deviceRefCount(): number {
  return _refCount;
}

// DEV diagnostic (PLUGIN-ARCHITECTURE §7.3) — exposes the shared-device refcount
// to the in-browser QA loop so leases can be asserted (`window.__ndeaDeviceRefCount()`
// should equal the number of GPU-initialized scatter instances). Tree-shaken out
// of production builds.
if (import.meta.env.DEV && typeof window !== "undefined") {
  (window as unknown as { __ndeaDeviceRefCount?: () => number }).__ndeaDeviceRefCount = deviceRefCount;
}
