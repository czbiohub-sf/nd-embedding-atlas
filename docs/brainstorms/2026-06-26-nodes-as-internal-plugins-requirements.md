# Nodes as internal plugins — requirements

**Date:** 2026-06-26
**Status:** Ready for `/ce-plan`
**Scope tier:** Deep — feature (frontend architecture; mostly structure + one new SDK shape)
**Builds on:** the node-folder colocation (`refactor/frontend-node-layout`, 6 commits) and the host-seam single-channel refactor.

## Problem / vision

The colocation pass put each node's files in one folder, but the folders are still ad-hoc piles. The next step: make a node a **self-registering module with a canonical internal structure** — "internal plugin–like." Fractal core+plugin: the app is `core/` + nodes; a _rich_ node is `core/` + sub-plugins. Charts is the case that forces it — it's not one node but a **family** (a type with variants sharing infra).

## Decisions

- **D1 — Node anatomy contract.** A canonical role vocabulary every node folder follows, applied **proportionally** (thin nodes have only what they need — no empty scaffolds):
  - `node.ts` — graph identity (`defineWsNode`: ports, cook, geometry). _Every node._
  - `plugin.ts` — the manifest (`defineDescriptor`: capabilities, `load()`, config). _View nodes._
  - `view.tsx` — body mount (was `<X>PluginView`).
  - `routing.ts` — cross-view host bindings (the Humble Object). _Nodes with gestures._
  - `ui/` — internal body components. `options.ts` — config schema when present.
    Enforced by a **fitness test** (every node resolves a `node.ts`-defined spec; present files follow the canonical names), not by mandatory files.

- **D2 — Canonical naming pass.** Rename across the existing ~15 node folders to the D1 vocabulary (`scatter.node.tsx`→`node.ts`, `ScatterPluginView`→`view.tsx`, descriptor `index.ts`→`plugin.ts`). Mechanical codemod, behavior-preserving.

- **D3 — `nodes/utils/` group.** The thin structural nodes (`obs · count · wrangle · cache · dataset · export · subnet · proxy`) live under one `nodes/utils/` group rather than 9 top-level one-file folders. Feature nodes stay top-level.

- **D4 — Node families: extract-after-two.** Families recur (charts now; likely `transform-filter` → threshold/range/expr later). **Build charts concretely first**; extract a general `defineNodeFamily` SDK primitive only once a second family proves the shape — avoids designing the family API against a sample size of one.

- **D5 — Charts = flagship family.** `nodes/charts/{ core/ (chart-type registry + chart-spec + panel frame), variants/<type>/ (each chart type, registered into core) }`, plus `node.ts`/`plugin.ts`/`view.tsx`/`routing.ts`. **Host-migrate charts in the same move** — route its selection-in through `host.*` and add a `HostProvider`, killing the `selectionBus` debt (the last host-seam holdout from `components/charts`).

## Sequence

1. **Mechanical (low risk, continuation of today):** D2 naming pass + D3 `utils/` grouping + D1 fitness test.
2. **Design-bearing (warrants the plan):** D5 charts — build the chart-type sub-registry + `variants/` + host-migration. This settles the family shape concretely.
3. **Later (out of this scope):** extract `defineNodeFamily` (D4) when a second family lands; migrate other families.

## Scope boundaries

**In:** the node anatomy contract + fitness test; the naming canonicalization; the `utils/` group; charts rebuilt as a concrete family + host-migrated.

**Out / non-goals:**

- No premature `defineNodeFamily` abstraction — charts is hand-rolled first, extracted later (D4).
- No other families migrated now (`transform-filter` stays as-is).
- No behavior change anywhere except charts, which gets a **behavior-equivalent** host-migration (same charts, now on the host seam).
- `scatter-gpu` shared-bits extraction → `nodes/scatter/gpu/` remains a separate prior follow-up.

## Success criteria

- Every node folder follows the canonical role names; a fitness test fails if a node ships without a `node.ts` spec or mis-names a role file.
- Thin structural nodes live under `nodes/utils/`; feature nodes top-level.
- Charts renders as today but as `nodes/charts/` with a chart-type registry + per-type `variants/` folders, and routes cross-view state through `host.*` (no `selectionBus` import — the `nodes/**` lint passes with charts now included).
- Gates: `vp check` 0 errors, `bun test` + the node-anatomy fitness test green, app runs (charts panel + cross-filter intact).

## Open questions (for `/ce-plan`)

1. Charts' chart-type registry: a local registry in `nodes/charts/core`, or reuse the app's `core/plugin/registry` with a namespacing convention?
2. `view.tsx` vs keeping `<X>PluginView.tsx` — does the canonical name lose useful grep-ability? (Naming bikeshed to settle once.)
3. Charts host-migration: does charts become an actual graph **node** (with a `node.ts` spec + port) or stay a view-only plugin? (It currently has no node spec.)
4. Does `nodes/utils/` use the same family/group mechanism as charts, or is it just a plain folder grouping?
