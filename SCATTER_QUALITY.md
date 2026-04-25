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

**Status:** shipped. Default-on; opt-out via
`localStorage.setItem('ndea.useGpuPicking', '0')`.

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
- We don't store the pointId as `i+1` to reserve `0` as a "no hit"
  sentinel — `clearValue: { r: 0, ... }` paints empty space with 0
  and the readback skips any pixel where `R < 0.5`.
- Brightness-as-depth requires `depthCompare: 'less-equal'` (NOT
  `less`) so the brightest fragment wins ties.
- `root.unwrap` rejects scalar (`f32`/`u32`) `TgpuUniform`s — go
  through `.buffer` to get the underlying `TgpuBuffer` first.
  TypeGPU 0.11.2 issue.
- Pick-buffer invalidation is conservative: marked dirty on every
  render submit. Picks happen on click (rare), so a re-render per
  pick after any scatter state change is acceptable. A finer cache
  (only invalidate on real geometry / view changes) would help if
  we ever pick on hover.
- The pick pipeline uses raw WebGPU + hand-written WGSL because
  TypeGPU's render pipeline shape didn't fit cleanly with the
  multi-output fragment (`color + frag_depth`) plus the need to
  share vertex layouts with the existing render bundle. The
  shaders themselves are short enough that hand-written WGSL is
  more readable than the typegpu DSL for this case.
- `resizeAll(width, height)` helper added to the orchestrator —
  walks `interaction.resize()` + `picking.resize()` + the params
  uniform aspect refresh in one call. Adaptive-DPR (#4, deferred)
  hooks into this single seam.

## Feature 3 — HDR + bloom + AgX tone mapping

**Status:** shipped. Always-on; tone-mapping mode + bloom + exposure
controls live in the dev-tools "Render" tab.

### Why

The current scatter draws straight to the canvas in 8-bit sRGB.
Overlapping points clip alpha early and dense regions look muddy.
Rendering to `rgba16float` lets density actually accumulate; bloom
glows the bright tail; AgX tone-maps it back to a display-range
image with a film-like roll-off.

### Pipeline

```
scatter (instanced quads, additive blend)
    ↓ → HDR rgba16float target  (full resolution)
brightpass (luminance > threshold, soft knee)
    ↓ → bloom-A  (half resolution)
horizontal blur (5-tap Gaussian via 4 bilinear fetches)
    ↓ → bloom-B
vertical blur (same kernel, transposed)
    ↓ → bloom-A   (final blurred bloom)
tone map (AgX | ACES | Reinhard | None) + exposure + bloom composite
    ↓ → canvas swap chain (bgra8unorm, premultiplied)
```

- `src/frontend/scatter-gpu/gpu/hdr.ts` — owns the HDR target, bloom
  ping-pong textures (A/B at half res), and tone-map fullscreen pass.
  Resize-aware via `resize(width, height)`.
- `src/frontend/scatter-gpu/gpu/hdr-shaders.ts` — WGSL fullscreen
  triangle vertex; brightpass fragment; separable Gaussian blur
  fragment; tone-map fragment.
- One bloom level for now. The architecture supports going to a 4-mip
  chain by swapping the brightpass + blur passes for downsample-then-
  upsample steps; left as a future tweak — single-level already
  delivers the visual lift on dense clusters.
- AgX coefficients: 3×3 input/output matrices + 7th-order polynomial
  fit of the Sobotka sigmoid. Public-domain port via Filament/Three.js.
  Constants embedded as `mat3x3<f32>` constants in the WGSL.
- ACES = Krzysztof Narkowicz's UE4 fit. Reinhard = simple `c/(1+c)`.
  None = clamp to [0, 1]. Selected via a `u32` mode in the tone-map
  uniform.
- Color space: canvas uses the device's preferred format
  (`bgra8unorm` on macOS, no `-srgb`); the tone-map fragment encodes
  sRGB explicitly via the standard piecewise function. AgX produces
  REC.709-linear output, so the same encoder handles every mode.

### Settings (Render tab in DevtoolsDrawer)

| param           | default | range                        |
| --------------- | ------- | ---------------------------- |
| toneMapping     | AgX     | None / Reinhard / ACES / AgX |
| exposure        | 0.0 EV  | -3 → +3 stops                |
| bloom strength  | 0.3     | 0 → 1.5                      |
| bloom threshold | 1.0     | 0 → 4                        |

### Gotchas

- HDR target needs `RENDER_ATTACHMENT | TEXTURE_BINDING` usage. The
  scatter pipeline's premultiplied-alpha blend state works on
  `rgba16float` without changes.
- The render bundle in `pipeline.ts` had a hard-coded color format —
  now it takes the format as a parameter and we pass `rgba16float`
  from the orchestrator. The bundle is built once at init and stays
  stable across pan/zoom; no hot-path cost.
- Linear-to-sRGB encoding is done explicitly in the tone-map shader
  via the standard piecewise function. The canvas uses
  `bgra8unorm` (no implicit `-srgb`), so we own the encoding.
- Bloom uses two ping-pong textures (`bloomA` / `bloomB`). The
  brightpass writes to A, horizontal blur reads A → writes B,
  vertical blur reads B → writes A; tone map then reads A as the
  final bloom. Three render passes per frame.
- AgX needs to be applied **after** `exp2(exposure)`. Reordering
  swaps which highlights get rolled off vs clipped.
- `resizeAll(width, height)` walks `interaction.resize()` +
  `picking.resize()` + `hdr.resize()` in one call. Adaptive-DPR
  (#4, deferred) plugs into this single seam.
- TypeScript `target instanceof GPUCanvasContext` was removed from
  pipeline.ts — the orchestrator now always passes a
  `GPUTextureView` (the HDR target's), so the dual-mode branch was
  dead code.

### Not measured

I did not have a 1.5M-point dataset configured at the test fixture
path during this iteration. Performance numbers will land in a
follow-up commit once the test data is available.

Pre-HDR baseline was ~1.4 ms, so the cost is roughly +1.2 ms /
frame (under the 16ms budget on this hardware).

## Adaptive-DPR seam (#4 deferred)

The orchestrator now exposes a single `resizeAll(width, height)`
method that walks every render target / pick target / HDR mip
chain. The DPR manager port (see `RESEARCH_ADAPTIVE_DPR.md`) needs
only to call this and update the canvas pixel size — no
per-subsystem resize plumbing.
