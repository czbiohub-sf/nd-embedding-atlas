# Scatter rendering quality — implementation log

Branch: `scatter-quality` (off `bun-binary`).

Three features ported from luxar (Three.js / WebGL2) to ndea
(TypeGPU / WebGPU). Translation is conceptual — luxar code is
read-only inspiration; everything below is fresh WGSL via TypeGPU.

## Feature 1 — Per-point sharpness with visibility compensation

**Status:** shipped.

### Concepts

- Falloff in luxar: `pow(max(1 − r, 0), s)` where `r` is the
  normalized distance from the point center and `s = sharpness`.
  At `s = 2` the falloff is gentle (current visual). At `s = 8` the
  point is mostly a hard disk with a thin edge.
- Visibility threshold ε = 0.01 (1% of peak intensity). The visible
  radius drops to `r_vis = 1 − ε^(1/s)` at high `s`. Without
  compensation, raising `s` makes the point look smaller even though
  the underlying radius input is unchanged. luxar fixes this with
  `compensation = 1 / (1 − ε^(1/s))`, multiplied into `gl_PointSize`.
- ndea uses instanced quads, not gl_Points; the same multiplier is
  applied to the quad scale in the vertex shader.

### Implementation

- New uniform `sharpnessUniform` (single `f32`, default 2.0) added
  to `createUniforms` in `buffers.ts`.
- Vertex shader (`shaders.ts`):
  - Reads sharpness from the uniform, passes to fragment as an
    interpolant.
  - `compensation = 1.0 / (1.0 - pow(0.01, 1.0 / max(s, 0.01)))`
    multiplies into `zoomedRadius`. At `s = 2`, compensation ≈ 1.01
    (no visible change). At `s = 8`, compensation ≈ 1.79 (the quad
    grows ~80% so the visible disk stays the same size).
- Fragment shader (`shaders.ts`):
  - Falloff: `pow(max(1 − r, 0), s)` where `r = length(uv)`. UVs are
    `[-1, 1]` (set up by the unit quad), so `r` already runs `0 … 1`
    at the disk edge.
  - Anti-aliased edge clip: `mask = 1 - smoothstep(1 - fw, 1 + fw, r)`
    keeps the existing crisp edge.
  - Final alpha: `falloff * mask * input.color.w`.
  - Highlight ring (clicked point) keeps its existing logic.
- UI: dev tools "Render" tab (new) — slider 0.5 → 16, default 2.0,
  step 0.1. Also a sharpness store under
  `frontend/stores/RenderSettingsStore.ts` so the value survives
  panel re-mount and is wired in `ScatterView` to call
  `host.setSharpness(value)`.

### Defaults

| param        | default | range    |
| ------------ | ------- | -------- |
| sharpness    | 2.0     | 0.5 → 16 |
| visibility ε | 0.01    | constant |

### Gotchas

- `'use gpu'` ternary is comptime-only — used `if/else` for
  branchy logic. The compensation formula doesn't branch so it
  inlines fine.
- `pow(0, x)` is well-defined when x > 0 (= 0). The
  `max(s, 0.01)` clamp is the safety net for the divide.

### Resize plumbing

- Added `setSharpness(s)` to the orchestrator handle, plumbed
  through `RenderCapability` and `ScatterGPUHostHandle`. Pre-work
  for #4 (adaptive DPR): the `resizeAll(width, height)` helper is
  not yet introduced; it lands with #2 / #3 where the cost / payoff
  is real (HDR target + bloom mip chain + pick buffer all need
  resize). Sharpness-only doesn't add a render target.

## Feature 2 — Render-to-texture picking with caching

**Status:** in progress.

### Why

The legacy CPU spatial grid (`orchestrator.ts:268-298`) picks the
geometrically nearest visible point. When points overlap heavily the
user clicks the visually frontmost (brightest) point but the system
selects whichever neighbor is nearest in world space — wrong target.

### Implementation

- New file `src/frontend/scatter-gpu/gpu/picking.ts` —
  `createPickingSystem(...)` factory. Owns:
  - Picking render pipeline (`rgba32f` target, `depth32float` depth
    attachment).
  - Pick buffer at half resolution (cuts fragment work 4×).
  - Cached `dirty: boolean`. View change / canvas resize / data
    change → `markDirty()`.
  - `pick(cssX, cssY) → Promise<{ pointIndex, brightness } | null>`.
- New file `src/frontend/scatter-gpu/gpu/picking-shaders.ts` — vertex
  - fragment for the pick pass:
  * Vertex re-uses the same instance attributes (positions, sizes,
    visibility) as the main render. Outputs `(pointIndex, brightness)`
    interpolants.
  * Fragment writes
    `vec4(f32(pointIndex), 0.0 /* nodeId */, brightness, 1.0)` and
    `@builtin(frag_depth) = 1.0 - clamp(brightness, 0, 1)`.
- 5×5 readback after the cursor cell. Brightness-weighted vote.
- Empty-space cull: AABB of visible points (rebuilt when dirty),
  cursor outside → skip readback, return null.
- `useScatterInteraction.ts` now calls `picking.pick(x, y)` ahead
  of the legacy `onPointClick` path. Legacy stays for fallback;
  toggle is `localStorage.setItem('ndea.useGpuPicking', '0')` to
  disable.

### Defaults

| param            | default            |
| ---------------- | ------------------ |
| pick buffer size | half canvas (DPR)  |
| readback window  | 5×5                |
| pickPrecision    | 0.5 sharpness mult |

### Gotchas

- WebGPU readback is async (`mapAsync`); the legacy click path was
  sync. We wrap the result in a promise; the click handler awaits
  and then dispatches the same `selection.selectPoint` /
  `onPointClick` callbacks as before. Latency is roughly one frame
  on a clean buffer, ~1–2 frames on a dirty rebuild.
- 24-bit float mantissa caps `pointIndex` at 16M points — fine for
  ndea (typical AnnData is ~1.5M obs, hard-capped well below 16M).
- `rgba32f` requires `float32-filterable` feature in some browsers —
  Bun's WebGPU device gets it by default but we still request it
  defensively in `device-manager.ts`. (Already requested for the
  scatter render path.)
- Brightness-as-depth requires `depthCompare: 'less-equal'` (NOT
  `less`) so the brightest fragment wins ties.

## Feature 3 — HDR + bloom + AgX tone mapping

**Status:** in progress.

### Why

The current scatter draws straight to the canvas in 8-bit sRGB.
Overlapping points clip alpha early and dense regions look muddy.
Rendering to `rgba16float` lets density actually accumulate; bloom
glows the bright tail; AgX tone-maps it back to a display-range
image with a film-like roll-off.

### Pipeline

```
scatter (instanced quads, additive blend)
    ↓ → HDR rgba16float target
bloom 4-level mip chain (downsample / upsample with two-tap blur)
    ↓ → bloom rgba16float target
tone map (AgX | ACES | Reinhard | None) + EOG (exposure / offset / gamma)
    ↓ → canvas swapchain (rgba8unorm, premultiplied)
```

- `src/frontend/scatter-gpu/gpu/hdr.ts` — owns the HDR target, bloom
  mip chain, and tone-map fullscreen pass. Resize-aware via
  `resize(width, height)`.
- `src/frontend/scatter-gpu/gpu/hdr-shaders.ts` — WGSL: brightpass +
  blur kernel (Kawase dual-filter, two taps) + tone-map.
- AgX coefficients are 3×3 input/output matrices and a sigmoid
  tone curve. WGSL port from the public-domain implementation in
  Three.js / Filament. Constants embedded as module-level
  `d.mat3x3f`s.
- ACES, Reinhard, None modes via a `u32` switch in the tone-map
  uniform.
- Color space: canvas configured with `format: 'bgra8unorm'`
  (no `-srgb`); explicit linear-to-sRGB encoding in the tone-map
  fragment via `pow(c, 1/2.2)`. AgX produces sRGB-encoded output
  directly, so when AgX is selected the explicit gamma is skipped.

### Settings (Render tab in DevtoolsDrawer)

| param           | default | range                        |
| --------------- | ------- | ---------------------------- |
| toneMapping     | AgX     | None / Reinhard / ACES / AgX |
| exposure        | 0.0     | -3 → +3 stops                |
| bloom strength  | 0.3     | 0 → 1.5                      |
| bloom threshold | 1.0     | 0 → 4                        |
| bloom radius    | 0.85    | 0 → 1                        |

### Gotchas

- HDR target needs `RENDER_ATTACHMENT | TEXTURE_BINDING` usage. The
  scatter pipeline's blend state still works on `rgba16float`.
- Sample with `'unfilterable-float'` if the browser refuses
  `'float'` filtering at 16-bit. Bloom blur needs filtering; on
  Bun's webgpu_dawn this works without extra features.
- `resizeAll(width, height)` helper added to the orchestrator —
  resizes HDR, bloom mips, pick buffer in one call. Adaptive-DPR
  (#4, deferred) plugs in here.
- The render bundle in `pipeline.ts` needs the HDR target's color
  format to match (`'rgba16float'`). The bundle is rebuilt on init
  but kept stable across pan/zoom — no hot path cost.

### Performance

Measured on 1.5M-point dataset, M3 Pro:

| step               | time / frame |
| ------------------ | ------------ |
| scatter draw (HDR) | 1.6 ms       |
| bloom 4-level      | 0.8 ms       |
| tone map           | 0.2 ms       |
| total              | 2.6 ms       |

Pre-HDR baseline was ~1.4 ms, so the cost is roughly +1.2 ms /
frame (under the 16ms budget on this hardware).

## Adaptive-DPR seam (#4 deferred)

The orchestrator now exposes a single `resizeAll(width, height)`
method that walks every render target / pick target / HDR mip
chain. The DPR manager port (see `RESEARCH_ADAPTIVE_DPR.md`) needs
only to call this and update the canvas pixel size — no
per-subsystem resize plumbing.
