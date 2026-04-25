# Path A — Additive blending plan

Goal: replace the current order-dependent premultiplied-alpha blend with
order-independent additive blending so dense scatter regions render
correctly regardless of GPU draw order. This is what Apple Embedding
Atlas, luxar, and most scientific point cloud viewers do.

This plan implements only Path A; the WBOIT alternative (Path B) stays
in the backlog (`memory/backlog_wboit.md`).

---

## Confirmed via research

### WebGPU blend semantics

The current `pipeline.ts:31-34` uses standard premultiplied-alpha:

```ts
blend: {
  color: { srcFactor: "one", dstFactor: "one-minus-src-alpha" },
  alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha" },
}
```

Equivalent GL: `glBlendFunc(GL_ONE, GL_ONE_MINUS_SRC_ALPHA)` — the
canonical "premultiplied alpha over" mode. Order-dependent: each
fragment composites onto whatever's already in the framebuffer.

For pure additive, switch to:

```ts
blend: {
  color: { srcFactor: "one", dstFactor: "one" },
  alpha: { srcFactor: "one", dstFactor: "one" },
}
```

ndea's fragment shader already returns _premultiplied_ color
(`vec4f(rgb * α, α)`), so `srcFactor: "one"` is the correct match — no
per-fragment alpha multiplication is needed in the blend stage.

luxar's reference uses Three.js `AdditiveBlending`, which compiles to
`(SRC_ALPHA, ONE)`. That's because their fragment outputs
_non-premultiplied_ `vec4(rgb, α)` and lets the blend stage handle the
premultiplication. End-result is identical to our `(ONE, ONE)` route
once you account for the convention difference.

### What WebGPU's `alphaMode: "premultiplied"` does

The canvas-level `alphaMode` (set in `init.ts:9`) only affects how the
final canvas texture composites with the page background — not how
fragments blend with each other inside the render target. So we can
freely change the in-pipeline blend without touching `alphaMode`.

### luxar has more than just "additive"

Their `material-manager.ts` defines five blend modes:
`'normal' | 'additive' | 'max' | 'opaque' | 'luminous'`. We probably
want at least `additive` and a fallback `premultiplied` (their `normal`)
for the case where category color identity matters more than density.
`max` (`blendOperation: "max"`) is also worth surfacing — gives
"brightest visible point" without color summing.

---

## Why additive is the right default for ndea

| Scenario                        | Premultiplied (current)                                  | Additive (proposed)                                               |
| ------------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------- |
| Sparse points                   | Each point fully opaque, no overlap → identical          | Same                                                              |
| 2-3 overlapping points          | Last-drawn color wins; visually flickers as GPU reorders | Colors sum (HDR) → tone-mapped to plausible blend                 |
| Dense cluster (10+ overlapping) | Random color                                             | Saturates toward white in HDR — tone mapping rolls off gracefully |
| Filtered-out (dimmed) points    | Alpha clips early → invisible too soon                   | Sub-1.0 contributions still register; tone mapping reveals them   |

The HDR pipeline the agent already shipped (`rgba16float` intermediate +
optional AgX tone mapping + bloom) is **specifically designed** to
absorb additive accumulation past 1.0 and roll it off. Path A leans
into that pipeline — without it, additive would just clip everything to
white.

The known cost: **categorical color identity in dense regions degrades**.
A heavy red cluster overlapping a heavy blue cluster summates to white,
not "mostly red with blue specks." For category coloring (`tab20`,
etc.) this matters; for continuous coloring (gene expression) it
doesn't, and most embedding-atlas use cases are continuous.

The escape hatch is the `Premultiplied` blend mode in the dropdown —
keeps current semantics for users who need to read category identity
in dense overlaps.

---

## Implementation steps

### Step 1 — Flip the blend mode (5 min)

`src/frontend/scatter-gpu/gpu/pipeline.ts:31-34`:

```ts
blend: {
  color: { srcFactor: "one", dstFactor: "one" },
  alpha: { srcFactor: "one", dstFactor: "one" },
}
```

That's it. Reload, eyeball.

Expected first impression: dense regions now look correct; sparse
regions look slightly _brighter_ than before because each point now
adds without being dimmed by `(1 - srcAlpha)` from the destination.

### Step 2 — Re-tune defaults so additive looks good out of the box (5 min)

`src/frontend/stores/RenderSettingsStore.ts`:

Earlier today I set tone-mapping to "none" and bloom to 0 to fix the
"3D ball" complaint. Path A needs them _back on_ because additive
overflows past 1.0 by design — without tone mapping that overflow
clips to flat white.

```ts
export const TONE_MAPPING_DEFAULT: ToneMapping = "agx"; // was "none"
export const BLOOM_STRENGTH_DEFAULT = 0.3; // was 0
export const BLOOM_THRESHOLD_DEFAULT = 1.0; // unchanged
export const EXPOSURE_DEFAULT = 0; // unchanged
```

The "3D ball" look came from the _gradient body_ in the falloff, not
the tone mapping itself. The flat-AA-disk shader I shipped after that
removes the gradient entirely, so AgX no longer creates the spherical
shading — it just rolls off the bright HDR overlaps.

If the user _still_ finds AgX too creamy, fall back to `"reinhard"`
(simpler curve, less stylized) or add a `"linear-clamp"` mode that
just clips at 1.0.

### Step 3 — Add point-opacity / density-alpha control (15 min)

The "sharpness" slider in the Render tab is currently a no-op (the
flat-disk shader ignores it). Repurpose it as `pointOpacity` —
multiplies the output alpha so users can tune how aggressively points
sum.

Sketch:

- `RenderSettingsStore.ts`: rename `sharpness` → `pointOpacity`, range
  `[0.05, 1.0]`, default `0.7`.
- `buffers.ts`: rename `sharpnessUniform` → `pointOpacityUniform`,
  same plumbing.
- `shaders.ts` fragment shader: `falloff *= pointOpacityUniform.$;`
  before the final premultiply.
- `RenderSettingsPlugin.tsx`: relabel the slider, update tooltip text.

This becomes the primary user-visible control. At `0.3` you need
~3 overlapping points to saturate, at `1.0` a single point dominates.

### Step 4 — Add a blend-mode dropdown (20 min)

Add `blendMode: "additive" | "premultiplied" | "max"` to
`RenderSettingsStore`. Default `"additive"`.

Plumbing:

- New `setBlendMode(mode)` setter.
- `pipeline.ts`: take a `blendMode` param when constructing the
  pipeline. Map to GPUBlendState:
  ```ts
  const BLEND_MODES = {
    additive: { color: { srcFactor: "one", dstFactor: "one" }, alpha: { srcFactor: "one", dstFactor: "one" } },
    premultiplied: {
      color: { srcFactor: "one", dstFactor: "one-minus-src-alpha" },
      alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha" },
    },
    max: {
      color: { srcFactor: "one", dstFactor: "one", operation: "max" },
      alpha: { srcFactor: "one", dstFactor: "one", operation: "max" },
    },
  } as const;
  ```
- `orchestrator.ts`: when blend mode changes, recreate the render
  pipeline (and the render bundle, since that bakes in pipeline
  identity). Keep a small cache so toggling between modes is cheap.
- `RenderSettingsPlugin.tsx`: dropdown next to the tone-mapping
  dropdown in the Render tab. Tooltip text:
  - Additive — order-independent, dense regions sum (recommended)
  - Premultiplied — preserves category color identity, order-dependent
  - Max — brightest-visible-only, useful for max-projection style views

### Step 5 — Verify the highlight ring still reads (10 min)

Concern: with additive on, the white outline ring on the clicked point
adds to whatever's underneath it instead of replacing. In a dense
cluster background that's already pushing white, the ring may not be
visible.

Verification path:

1. Run the dev server, click a point in a dense cluster.
2. Compare the ring's contrast vs current premultiplied build.
3. If contrast drops noticeably, render the highlighted instance in a
   separate small pass _after_ the main additive pass, with
   premultiplied alpha blending — only one fragment at most so the
   "second pass" cost is one quad's worth of fragments. The orchestrator
   already has a clean place to inject this between the main scatter
   draw and the picking pass.

This is the only step with a non-trivial chance of needing a real fix.
Treat the second-pass override as a known fallback.

### Step 6 — Visual delta verification (15 min)

Use agent-browser against the running dev server. Take pre/post
screenshots in three regimes:

1. **Sparse** — single isolated points. Should look identical.
2. **Medium** — moderate overlap (~3-5 points per cluster). Should
   look _more correct_ — premultiplied flickers, additive is stable.
3. **Dense** — heavy cluster (>10 points). Premultiplied shows random
   color, additive shows tone-mapped white-glowing density.

Capture at the same dataset / zoom / color column for each. Land them
in `SCATTER_QUALITY.md` under a new "Path A — additive blending"
section.

---

## Total estimate

~70 minutes if everything goes smoothly. The core change (Step 1) is
literally 4 characters. The tune-ups (Steps 2–4) make the new mode
_usable_. Step 5 is a safety check, Step 6 is documentation.

## Things that don't change

- AnnData/MuData/OME-zarr inputs — untouched.
- The flat-AA-disk shader — already correct, additive composes onto it.
- The HDR + bloom + tone-mapping pipeline — already designed for this.
- The GPU picking system — separate render target, unaffected.
- The compositor / tier system — operates on selectedBuffer, unaffected.

## Things that could surprise us

- **Tier-1 dim factor doubles up**: the existing dim factor (~0.32)
  multiplies fragment alpha. Under additive, two dimmed overlapping
  fragments contribute `0.32 + 0.32 = 0.64` — visually brighter than
  expected. May want to halve the dim factor when blend mode is
  additive, or accept that "moderate dim" reads as "less dim in dense
  regions."
- **Filtered-out points (tier-0)**: collapsed to degenerate triangles
  in the vertex shader (`vis = 0` → zero-area quad), so they never
  produce fragments. Not affected.
- **Zoom-out behavior**: at extreme zoom-out, every pixel has many
  overlapping points → entire view washes to bright tone-mapped color.
  Already true with HDR + bloom; additive just makes it more so. The
  "Exposure" slider lets users compensate.
