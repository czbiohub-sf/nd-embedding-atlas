---
icon: lucide/compass
---

# WebGPU Setup on HPC (Chrome)

Firefox will **not** work, the ESR build on HPC systems typically does not support WebGPU.

---

## Chrome Setup (one-time)

1. Open Chrome and go to `chrome://flags`
2. Search and **Enable** each of these flags:
    - `#enable-vulkan`
    - `#default-angle-vulkan`
    - `#vulkan-from-angle`
    - `#enable-unsafe-webgpu`
3. Click **Relaunch**

---

## Verify it worked

Open the browser console (`F12`) and run:

```js
const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
console.log(
    adapter
        ? "WebGPU ready: " + (await adapter.requestAdapterInfo()).device
        : "WebGPU not available",
);
```

You should see something like: `WebGPU ready: NVIDIA A40`

---

## Troubleshooting

- **"requestAdapter returned null"** — Make sure all 4 flags are enabled and you relaunched Chrome.
- **Check `chrome://gpu`** — Scroll to "Dawn Info". Look for `Vulkan backend - NVIDIA A40` with `[WebGPU Status] Available`.
- **Only "OpenGLES backend (Compatibility Mode)" appears** — The Vulkan flags didn't take effect. Double-check `chrome://flags`.
