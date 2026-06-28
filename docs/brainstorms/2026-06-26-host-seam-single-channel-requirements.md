# Host seam as the single cross-view channel — requirements

**Date:** 2026-06-26
**Status:** Ready for `/ce-plan`
**Scope tier:** Deep — feature (internal architecture; product shape unchanged)
**Grounding dossier:** `~/.claude/jobs/28b191ae/tmp/ce-brainstorm-arch/grounding.md`

## Problem

A plugin/node body can bind cross-view state (focus, selection, predicate, view-sync) to the **global dashboard/bus channel** instead of the per-node **`host` seam**. Such a node _looks_ wired but its interactions never reach its sync group / edges. The Gallery node shipped with exactly this: `GalleryPane` wrote `useDashboard().actions.setHighlight` instead of `host.highlight.set`, so crop clicks never reached sync group "A" (fixed 2026-06-26). The fix was per-instance; nothing prevents the **next** node from repeating it.

This is the bug _class_ the work targets — not the Gallery instance.

## Root cause (verified)

Two parallel state channels exist:

- **Host seam** — `host.highlight / inputSelection / publishPredicate / publishRowSet / viewSync` (`src/frontend/core/plugin/host.ts`). `body-dock.tsx` proxies it to be sync-group- and edge-aware.
- **Global channel** — `useDashboard()` + `src/frontend/core/buses` / `stores` (`highlightBus`, `selectionBus`, `selectionSyncStore`, `viewSyncStore`).

The shared `components/**` bodies that plugin views render (`ScatterView`, `GalleryPane`, `useLassoSelectionObs`, …) serve **two mount contexts** and branch at every cross-view touchpoint:

```
const setHighlight = (id) => { if (host) host.highlight.set(id); else actions.setHighlight(id); }
```

gated on `useOptionalHost()` being non-null. This **dual-path is the bug generator** — it is _ambient authority_ (a reachable global). Two failure modes: forget the `if (host)` branch for one channel → silent fall to global; or render a body with no host → every channel falls to global.

Enforcement gap matches exactly: the Oxlint `no-restricted-imports` ban (`vite.config.ts:259`) globs **`plugins/**`only**; the shared`components/\**` bodies import buses/`useDashboard` freely. And the Gallery bug was a *missing branch\*, not a banned import — so widening the import-ban alone would not have caught it.

Null-host contexts are narrow and known: `useOptionalHost()` returns `null` only for standalone render paths that bypass `PluginMount` — documented case: the **floating-scatter window** renders `ScatterContent` directly. `useHost()` (required, throws outside a provider) already exists.

## Decision: implement B + C + A

The fix is **B**; robust delivery is **B + C + A** in sequence. Named paradigms (researched):

- **B — eliminate the ambient authority (object-capability + make-illegal-states-unrepresentable).** Make the `host` the sole, **non-optional** cross-view channel; the global bus becomes unreachable from a body. This removes the _ability_ to make the mistake (no `else` branch, no importable bus) rather than detecting it after the fact. This is the architecturally sound core — the others are enforcement, not substitutes.
- **C — fitness-function conformance harness.** A registry-driven test that, for each registered _view_ node, mounts it against a spy host and asserts each gesture (click/lasso/sync) routes through `host.*`, never the global bus. Catches the _missing-branch_ class behaviorally (what lint cannot), proves the B migration preserved behavior per node, and auto-covers every future node (like `node-registry.test.ts`). Uses the **Humble Object** split so routing logic is unit-testable without a live WebGPU/Mosaic shell.
- **A — architectural boundary lint.** Forbid `components/**` bodies from importing the cross-view buses / `DashboardContext`. Tooling note: the stack is **Oxlint, not ESLint**, so `eslint-plugin-boundaries` does not apply; use **dependency-cruiser** (linter-agnostic, element-type-aware, CI-runnable) layered over the existing Oxlint `no-restricted-imports`.

### Sequence (each step verified by the one before)

1. **C scaffold** — capture current correct routing per node as the regression net.
2. **B** — give every standalone/floating render path a host (shim-backed), flip `useOptionalHost`→`useHost`, delete dual-paths, move legit metadata reads onto `host.data`.
3. **A** — turn on the boundary lint once no body legitimately imports a cross-view bus (airtight only after B).

## Surface (what the contract must cover)

The **full cross-view contract**, not just highlight: focus/highlight, selection-in (`inputSelection`/`externalRowSet`), selection-out/predicate (`publishPredicate`/`publishRowSet`), and view-sync.

Bodies in scope (plugin → rendered shared component): scatter→`ScatterContent`/`ScatterView`, gallery→`GalleryPane` + `useLassoSelectionObs`, image-viewer→`CropViewer`, charts→`ChartPanelList`, table→`DataTable`, plus `viewer/ViewerControls`. 16 node specs; view-kind nodes get the edge-bound proxy host.

## Success criteria

- No shared body reads/writes cross-view state through `useDashboard()` or a global bus; all of it flows through `host.*`. (`useDashboard` may remain only for non-cross-view metadata, or that too moves to `host.data`.)
- `useOptionalHost()` is gone; bodies use `useHost()`. Every render path (including floating/standalone windows) supplies a host.
- A conformance test fails if any registered view node routes a cross-view gesture to the global bus instead of the host.
- A boundary check (dependency-cruiser) fails CI if a `components/**` body imports a cross-view bus / `DashboardContext`.
- No user-facing behavior change: linking that worked still works; the floating-scatter window and dashboard/dock mount keep functioning.

## Scope boundaries

**In:** the cross-view routing contract for plugin/node bodies; the conformance harness; the boundary lint.

**Out / non-goals:**

- No process isolation (VS Code-style) — too heavy; not the failure mode.
- No new user-facing feature; this is a behavior-preserving refactor + guardrails.
- Not retiring the global buses/`DashboardContext` themselves — they remain the _implementation_ the host shim delegates to for non-node mounts; only **direct reach from bodies** is removed.
- Not the legacy dashboard/dock mount's own architecture beyond ensuring it supplies a host.

## Risks & assumptions

- **Floating/standalone windows are the migration's real work.** Making the host non-optional requires every such path to provide a host (the shim host, or a dedicated standalone host). Risk: a path is missed → runtime throw from `useHost()`. Mitigation: C-harness + an audit of every body render site before flipping.
- **Assumption:** the dashboard/dock mount already supplies the shim host (dossier indicates so); planning must confirm and enumerate _all_ host-less render sites, not just floating-scatter.
- **C feasibility for WebGPU bodies:** scatter cannot be headless-mounted with a live GPU. Assumption: the Humble Object split makes its _routing_ testable without the canvas; planning validates the split boundary.
- **Regression risk during B** touching scatter/gallery/viewer — the reason C is scaffolded first.

## Outstanding questions (for `/ce-plan`)

1. Enumerate **all** host-less render sites (beyond floating-scatter) — is the dashboard/dock mount truly host-backed everywhere?
2. Where exactly is the Humble Object boundary for scatter (what is the minimal "routing" object to extract and test)?
3. Does metadata fully move to `host.data`, or does a non-cross-view `useDashboard` read stay (and is that allowed by the boundary lint)?
4. dependency-cruiser as a new `vp`/CI step vs. extending Oxlint `no-restricted-imports` to `components/**` — or both? (A's exact mechanism.)
5. Migration order across the 6 bodies — all at once, or one body per commit behind the harness?
