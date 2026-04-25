# Adaptive DPR — research notes (feature #4, deferred)

Sources surveyed via tavily on 2026-04-25 ahead of porting from luxar's
`adaptive-dpr-manager.ts`.

## Why this is needed

Drawing at full `devicePixelRatio` is slow — phones report DPR up to 4 (16×
fragments per CSS pixel). On weak GPUs or when the canvas is huge, an ndea
scatter at native DPR drops to single-digit FPS while remaining buttery at
75% scale. The user can't tell the difference at 60fps; they very much can
at 12fps. Adaptive DPR pays the resolution cost only when the GPU has
budget for it.

## Key references

### `webgpufundamentals.org/webgpu/lessons/webgpu-resizing-the-canvas.html`

- Cap DPR at 2 by default: `dpr = Math.min(2, devicePixelRatio)`
- Let users override via a settings slider — what console games do
- Use `ResizeObserver` with `devicePixelContentBoxSize` (not `contentBoxSize`)
  for sub-pixel-accurate sizing in flex/grid layouts
- `device.limits.maxTextureDimension2D` is the hard ceiling; clamp to it

### `gpuweb/gpuweb#2379` — Dynamic Resolution Rendering with WebGPU

- Concept: shrink the render target each frame if GPU-bound
- Two implementation strategies:
  - **Cheap**: allocate the largest target up-front, vary the viewport
    sub-rectangle. Forces every shader that samples that target to carry
    a UV rescale factor. Maintenance cost is high if you have many shaders.
  - **Real**: actually resize textures. Cleaner downstream, costs an
    allocation per scale change.
- For ndea: the second is fine since resolution changes are rare (once per
  few seconds at most) and only the present canvas + bloom mip chain need
  resizing.

### Martin Fuller (Microsoft) — DRS Implementation Best Practice

- Don't drop resolution too aggressively or recover too slowly
- Build a calibration table per scene if possible: render fixed test points
  at each resolution, record GPU time
- Debug mode: cycle resolution every frame randomly. Exposes UV-rescale
  bugs and synchronization issues that are otherwise hard to repro

### Meta Horizon (VR) — same pattern, different telemetry

- FPS-based heuristic: drop scaling factor when frames drop, raise when GPU
  underutilized
- Telemetry buckets (`Stale2/5/10/max`) for tracking severity

## Algorithm — what to copy from luxar

luxar's `adaptive-dpr-manager.ts` (see
`/Users/sricharan.varra/Biohub/luxar/packages/luxar-viewer/src/rendering/adaptive-dpr-manager.ts`):

1. **FPS sampling** — 1-second sliding window of frame timestamps in a
   ring buffer (`frameTimestamps[]`, `frameStartIndex`). O(1) insert + O(n)
   trim where n is small.
2. **Evaluation cadence** — every 500ms (configurable). Reduces hysteresis
   noise from per-frame jitter.
3. **Down-scale**: if `fps < minFPS` (e.g. 30), apply
   `currentDPR *= scaleDownFactor` (e.g. 0.85). Immediate, no hysteresis.
   Drop frames are bad — react fast.
4. **Up-scale**: only if `fps > maxFPS` (e.g. 55) sustained for
   `hysteresisSeconds` (e.g. 2). Slow recovery. Don't bounce.
5. **Clamp** between `minDPR` (e.g. 0.5) and `window.devicePixelRatio`
   (capped to 2 if performance is a concern).
6. **Apply** — call into the renderer to resize the swap chain + any
   intermediate render targets (bloom mip chain, pick buffer, etc.).

## What to do in ndea

When implementing later (post #1–#3):

- New `src/frontend/scatter-gpu/dpr-manager.ts` — port luxar's class.
- The orchestrator render loop is the natural FPS sampling site
  (`scheduleLoop()` already calls a `loop()` function with a frame index).
- The resize path needs to flow through the WebGPU canvas
  (`ctx.configure({ device, format, ... })` reset on resize) AND any
  intermediate render targets we add for HDR + picking. Defining a
  `resizeAll(width, height)` helper on the orchestrator keeps the DPR
  manager decoupled from each subsystem.
- Settings UI: a "render quality" toggle in the existing dev tools panel
  with options Low / Auto / High; Auto runs the adaptive loop, Low pins
  DPR to 1.0, High pins to `devicePixelRatio` (capped at 2).
- Persist the user's choice in localStorage.

## Why we're not implementing today

Features #1–#3 (HDR/bloom/tone mapping, render-to-texture picking,
per-point sharpness) all create new render targets and new render passes.
Once those are landed and stable, the DPR manager has clear seams to plug
into via a single `resizeAll()` call. Doing DPR first would force us to
keep refactoring its resize hook every time a new pass lands.

Estimated effort: half a day after #1–#3 are merged.
