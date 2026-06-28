---
title: "refactor: Track 2 — compact sliders + finish the nd→shadcn uplift"
type: refactor
date: 2026-06-26
status: ready
depth: standard
---

# refactor: Track 2 — compact sliders + finish the nd→shadcn uplift

## Summary

Track 2 of the UI consolidation aimed to collapse the bespoke `nd/` layer onto the shadcn (Base UI) `ui/` base. Reconnaissance found **most of it already done**: `NdBracketed`/`NdChip` are already re-exports of `ui/bracketed`/`ui/dimension-badge`, and every slider in the app — including the Idetik channel contrast and the scatter continuous-color domain — already uses the Base-UI-backed `ui/slider` (both as two-thumb range sliders). What actually remains is small and concrete: the sliders are visually **too big** for the instrument density, the canvas icon-button is the one `nd/` primitive still on a raw `<button>` instead of deriving from shadcn, the built-but-unadopted `ui/icon-button` should be put to work at its intended chrome call sites, and a few stale artifacts need cleanup.

This plan delivers the compact slider sizing (the headline ask), finishes the icon-button uplift, and records the boundary so we don't re-investigate this layer again.

---

## Problem Frame

The user's directive: "uplift everything we can to one central standardized shadcn ui base; if and only if we need custom, derive it from shadcn." Plus two specific asks: sliders are "kinda big, can we make it smaller?", and the Idetik channels + scatter continuous color should use a range (two-thumb) slider.

Recon resolved the range-slider ask (already satisfied) and narrowed the rest to a focused set. The remaining risk this plan addresses is **drift**: a raw-`<button>` canvas primitive and a dead `ui/icon-button` are exactly the kind of half-migrated state that invites future rework. Closing them — and writing down what is deliberately bespoke — is the point.

---

## Requirements

- **R1** — Sliders render at instrument density (visibly smaller track + thumb) everywhere `ui/slider` / `SliderRow` is used, with thumbs still grabbable on desktop. (user: "make it smaller")
- **R2** — The Idetik channel contrast control and scatter continuous-color domain are two-thumb range sliders on the shadcn Base UI `Slider`. **Already satisfied** (ChannelControls, ContinuousLegend) — this plan only verifies and benefits from R1's resizing.
- **R3** — Custom canvas controls derive from shadcn/Base UI primitives where one exists. The outstanding case is `nd-icon-button` (raw `<button>` today).
- **R4** — The built-but-unused `ui/icon-button` is adopted at the chrome call sites it was written for, or explicitly deferred with a reason — no dead component left ambiguous.
- **R5** — The bespoke/derived boundary is documented: which `nd/` pieces stay bespoke (no shadcn twin) and why, and that the bracketed/chip/slider work is already on shadcn. So Track 2 is not re-investigated.

---

## Key Technical Decisions

- **Shrink the `ui/slider` default rather than add a size variant.** The user wants sliders smaller _everywhere_; no site asked for the current larger size. Shrinking the default is the smallest change that satisfies R1. Target: track `h-3`→`h-1.5` (6px), thumb `size-4`→`size-3` (12px), control `py-2`→`py-1`. If a future site needs a larger slider, add a `size` variant then — not now. _(ponytail: don't build the variant until a second size is actually needed.)_
- **`nd-icon-button` derives from `@base-ui/react/button`, but stays a distinct canvas component.** It is genuinely different from `ui/icon-button` (14–15px instrument micro-button with `data-nodrag`, `stopPropagation`, the `NdIcon` registry, and instrument tones vs. a 22–26px tooltip-enforced chrome button). The "derive from shadcn" rule is satisfied by basing both on the same Base UI `Button` primitive — **not** by merging them into one component. Merging would force canvas concerns into the chrome button and vice-versa.
- **`ui/icon-button` is adopted, not deleted.** Its docstring names its intended consumers (BottomDock, ScatterOverlayControls, toolbar strips that hand-roll `HoverTip + ToggleGroupItem`). Adopting it is the "uplift to one base" the user asked for. The broad sweep of every chrome call site may exceed this plan's appetite; U3 migrates the clear cases and defers a long tail explicitly if one exists.
- **`NdBracketed`/`NdChip` stay as vocabulary aliases.** They already re-export `ui/bracketed`/`ui/dimension-badge`. The alias is intentional (the workspace speaks "chip"/"bracketed" in its own vocabulary while the implementation lives in `ui/`). No change.

---

## Implementation Units

### U1. Compact slider sizing

**Goal:** Sliders render at instrument density everywhere. (R1)

**Dependencies:** none.

**Files:**

- `src/frontend/components/ui/slider.tsx` (modify — track height, thumb size, control padding)
- `src/frontend/components/ui/slider-row.tsx` (verify — its `density` rungs and label/value column widths still read well against the smaller slider; adjust gap/widths only if needed)

**Approach:** In `slider.tsx`, reduce the `SliderPrimitive.Track` height (`data-horizontal:h-3` → `h-1.5`, `data-vertical:w-3` → `w-1.5`), the `SliderPrimitive.Thumb` (`size-4` → `size-3`), and the `SliderPrimitive.Control` padding (`data-horizontal:py-2` → `py-1`). Keep the `hover:ring-4`/`focus-visible:ring-4` affordance so the smaller thumb still has a generous hit/focus halo. Leave behavior (multi-thumb, value mapping) untouched.

**Patterns to follow:** existing density tokens in `slider-row.tsx` (`text-3xs`/`text-2xs`, `w-5`/`w-6`).

**Test scenarios:** Test expectation: none — pure styling, no logic change. Verify in the running app that all six slider sites still render and drag: `ui/oklch-color-picker` (1 Slider + 3 SliderRow), `scatter/ContinuousLegend` (range), `viewer/VolumeControls`, `viewer/ViewerControls` (3 SliderRow), `viewer/ChannelControls` (range). Both thumbs of the two range sliders remain independently grabbable at the smaller size.

**Verification:** `vp check` clean; visual pass shows noticeably thinner sliders across viewer + scatter + color picker with thumbs still easy to grab.

---

### U2. `nd-icon-button` derives from the Base UI Button

**Goal:** The canvas icon-button derives from shadcn/Base UI instead of a raw `<button>`, while keeping its instrument identity. (R3)

**Dependencies:** none.

**Files:**

- `src/frontend/components/nd/nd-icon-button.tsx` (modify)

**Approach:** Replace the raw `<button>` with `@base-ui/react/button`'s `Button` (the same primitive `ui/icon-button` uses), preserving the existing `cva` (tones default/active/amber, compact sizes 14/15px), the `NdIcon` render, `data-nodrag="1"`, `onPointerDown` stopPropagation, and the `{icon,title,onClick,active,tone,compact,label}` prop surface. No API change — the 8 importers and `nd-form-controls` must keep compiling untouched. _(Low functional value — a raw button works — but it honors the "derive custom from shadcn" rule and makes the canvas button consistent with the chrome one. Flagged so the reviewer knows it's a consistency move, not a bug fix.)_

**Patterns to follow:** `src/frontend/components/ui/icon-button.tsx` (how it wraps `ButtonPrimitive` with a `cva` + `cn`).

**Test scenarios:** Test expectation: none beyond gates — behavior-preserving refactor of a presentational button with no current test. Verify: `vp check` + `bun test` stay green; in-app, node-header buttons (form-cycle, lock, plugin actions) still click, still don't start a node drag (`data-nodrag` intact), still stop propagation.

**Verification:** `vp check` 0 errors; the 8 `nd-icon-button` importers compile unchanged; node headers behave identically.

---

### U3. Adopt `ui/icon-button` at its chrome call sites

**Goal:** Put the built-but-unused `ui/icon-button` to work; remove hand-rolled chrome icon buttons. (R4)

**Dependencies:** none (independent of U2 — different component, different consumers).

**Files (discover precisely during execution; starting points from `ui/icon-button` docstring):**

- `src/frontend/components/layout/**` (BottomDock and toolbar strips)
- `src/frontend/components/scatter/**` (ScatterOverlayControls / ScatterToolbar)
- `src/frontend/components/ui/icon-button.tsx` (target — extend only if a real gap appears)

**Approach:** Grep for the hand-rolled pattern the docstring describes — `HoverTip` wrapping a `ToggleGroupItem`/`<button>` with a `size-[22px]`-class icon — across chrome (non-canvas) components. Migrate each clear case to `<IconButton label description pressed>…</IconButton>`. If a site needs behavior `ui/icon-button` lacks (e.g. it must be a `ToggleGroupItem` inside a roving toggle group), leave it and record why under Deferred rather than forcing it. Do not touch canvas (`nd/`, `core/workspace/`) buttons — those are U2's `nd-icon-button`.

**Patterns to follow:** the `ui/icon-button` docstring example; existing `HoverTip` usage at the target sites.

**Test scenarios:**

- Happy path: each migrated control still fires its action on click and shows its tooltip on hover.
- Toggle semantics: controls that represent on/off state expose `aria-pressed` correctly via the `pressed` prop.
- a11y: every migrated icon-only button has an accessible name (enforced by `IconButton`'s required `label`).
- Test expectation: where a site has existing component tests, keep them green; otherwise none — verify in-app.

**Verification:** `vp check` + `bun test` green; the migrated chrome controls look and behave the same; `ui/icon-button` has real importers (no longer dead).

---

### U4. Boundary cleanup + documentation

**Goal:** Remove stale artifacts and record the bespoke/derived boundary so Track 2 isn't re-investigated. (R5)

**Dependencies:** U1–U3 (document the end state).

**Files:**

- `src/frontend/components/scatter/ContinuousLegend.tsx` (modify — replace the stale "Dual native `<input type="range">` overlaid…" comment at the top of the component, which describes a removed implementation; the live code uses the shadcn range `Slider`)
- `src/frontend/components/ui/README.md` (modify — add a short "nd/ ↔ ui/ boundary" note)

**Approach:** Fix the misleading ContinuousLegend comment to describe the actual shadcn `Slider`. In `ui/README.md`, document: (a) `NdBracketed`/`NdChip` are vocabulary aliases re-exporting `ui/bracketed`/`ui/dimension-badge` — not duplicates; (b) the genuinely-bespoke `nd/` pieces that have no shadcn twin and stay (`nd-node-frame`, `nd-port`, `nd-resize-grips`, `nd-breadcrumb`, `NdSpecPage`, `PrqlEditor`, and the telemetry atoms `NdLed`/`NdHud`/`NdKv`/`NdCaption`); (c) `nd-icon-button` is the canvas-specific button that _derives_ from the same Base UI `Button` as `ui/icon-button` (two variants, one primitive).

**Test scenarios:** Test expectation: none — comment + docs only.

**Verification:** `vp check` clean (comment change compiles); README reads accurately against the code.

---

## Scope Boundaries

**In scope:** compact slider sizing (R1); `nd-icon-button` deriving from Base UI Button (R3); adopting `ui/icon-button` at clear chrome call sites (R4); stale-comment + boundary docs (R5).

**Already satisfied (verified during recon — no work):**

- `NdBracketed` → `ui/bracketed`, `NdChip` → `ui/dimension-badge` (already re-exports).
- All sliders on Base-UI `ui/slider`; Idetik channels + scatter continuous color already two-thumb range sliders (R2).

### Deferred to Follow-Up Work

- Any long tail of chrome icon-button call sites that U3 can't cleanly migrate (e.g. controls that must remain `ToggleGroupItem` inside a roving group) — record each with its reason during U3 rather than forcing the migration.
- Broader `nd/` ↔ `ui/` form-control convergence beyond icon-button (none found outstanding — sliders/toggles/inputs already on `ui/`).

### Out of scope

- The already-shipped node-contract, glass-system, and Add-Node-menu work.
- Any visual redesign beyond the slider resizing the user requested.

---

## Verification Strategy

Per-unit gates: `vp check` (0 errors) and `bun test` (251 passing) after each unit. U1 and U3 additionally need an in-app visual/interaction pass (the dev server against the infectomics dataset) because their correctness is partly visual — slider grab-ability and chrome-control parity don't show up in the type/test gates.
