# Phase 1: GPU Correctness — Shared Device Singleton + Selection Callback Fix

Fix two CRITICAL WebGPU bugs in the scatter-gpu module. Read each file before editing.

## BUG 1: Each scatter panel creates its own GPUDevice → crashes after 4+ panels open

WebGPU limits concurrent devices to ~6-8. Every `createScatterplot()` calls `tgpu.init()`
which requests a new GPUAdapter + GPUDevice. Must share one device across all panels.

### Step 1: Create `frontend/src/scatter-gpu/gpu/device-manager.ts`

```ts
import tgpu from "typegpu";

type DeviceInfo = {
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
    const adapter = await navigator.gpu?.requestAdapter();
    if (!adapter) throw new Error("WebGPU adapter not available");
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
```

### Step 2: Modify `frontend/src/scatter-gpu/gpu/init.ts`

Read the file first. Change `initGPU()` to:
- Call `acquireDevice()` from `./device-manager`
- Use `tgpu.initFromDevice({ device })` instead of `tgpu.init()`
- Return the root, plus device/context/format/preferredWorkgroupSize from acquireDevice

Key: `tgpu.initFromDevice` docs say `root.destroy()` is a no-op — safe for per-panel cleanup.

### Step 3: Modify `frontend/src/scatter-gpu/gpu/orchestrator.ts`

Read the file first. In `createScatterplot()`:
- Call `acquireDevice()` at the top to get `{ device, format, preferredWorkgroupSize }`
- Pass these to `initGPU(canvas, deviceInfo)` (update the signature)
- In the returned `destroy()` method, add `releaseDevice()` call after `root.destroy()`

---

## BUG 2: `clearSelectionExternal` never fires `onSelectionChange` → status bar shows stale count

Read `frontend/src/scatter-gpu/gpu/selection.ts`. Find `clearSelectionExternal()`.
It clears the GPU buffer but never calls `onSelectionChange(null)`.
Compare with `clearSelection()` which does call it. Add `onSelectionChange(null)` to match.

---

## Validation

```bash
cd frontend && pnpm exec tsc --noEmit
```

Fix ALL TypeScript errors before finishing. The app should typecheck cleanly.
