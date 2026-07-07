---
date: 2026-07-06
topic: annotate-preset
---

# Annotate preset + build-gated node editor

## Summary

Ship an `annotate` preset: `ndea <config> --preset annotate` — and any shipped
build launched with no `--preset` — opens a fixed, frozen annotate dashboard
(Scatter / Idetik / Gallery / Table / Annotate) built from a bundled node graph.
Node authoring is compiled out of shipped builds (dev-server-only for now), so
users operate the panels but can't add, delete, rewire, or re-tile.

---

## Problem Frame

The node system is in flux and not ready to hand to end users — but the annotate
workflow it produces is. Today every launch opens the full node editor, so a
researcher who just wants to lasso, label, and view crops is dropped into a graph
authoring surface they shouldn't touch (and that may not load in a future
version). Two needs fall out: expose the _result_ (a ready annotate dashboard)
without the editor, and make that curated setup reproducible from one launch
command.

This builds directly on the resolved preset design (`.design/preset-replay-plan.md`,
Plan v2) — the flat-locked-preset approach — narrowed to the annotate case plus a
tightening: the editor is absent from builds entirely, not merely locked.

---

## Key Decisions

- **Authoring is compiled out of builds, gated on `import.meta.env.DEV` — dev-server-only for now.**
  Not a runtime `--dev` flag. The editor is genuinely absent from a shipped
  binary; authoring lives only in `vp run dev`. Swap the gate for a flag later,
  when the node system stabilizes.
- **Freeze removes the authoring affordances and fixes the layout — it keeps the graph.**
  The graph, its view bodies, and their interactions (lasso, label, crop viewing,
  write-to-`.obs`) all run; only add/delete/rewire/re-tile are gone.
- **A preset presents as its saved dashboard, not the node canvas.** The preset
  captures graph _plus_ stage layout; a build opens the tiled panels (image 1),
  never the canvas (image 2).
- **Read-only builds drop Plan v2's in-build machinery.** No per-preset scratch
  key, "reset to preset" command, editable allow-list, or dev-in-flux warning —
  there is nothing to persist when nothing is editable.
- **The annotate preset is the default.** A build with no `--preset` falls back to
  the annotate seed graph.
- **Reuse Plan v2's seam.** A preset is one bundled `PersistedDoc`, loaded through
  the existing load-or-seed + validate/migrate path; the active preset name rides
  `/data/metadata.json` (what the frontend already reads), not the legacy
  `/api/config`.

---

## Requirements

### Launch & default

- R1. `ndea <config> --preset annotate` opens the frozen annotate dashboard.
- R2. A shipped build launched with no `--preset` opens the same annotate
  dashboard — annotate is the default seed.
- R3. Presets bundle in the binary and resolve by name; the active preset name
  reaches the frontend via `/data/metadata.json`.

### Freeze / build gating

- R4. In a shipped build the node-authoring affordances are absent: the `Tab`
  palette, the right-click add-node menu, node add/delete/rewire, and stage
  re-tiling.
- R5. Authoring is gated on `import.meta.env.DEV` — live in the Vite dev server,
  compiled out of every shipped build (no runtime flag).
- R6. The graph and every view body stay fully interactive in a build: lasso in
  Scatter, label in Annotate, crop viewing in Idetik/Gallery, write-to-`.obs`.
- R7. A build persists no graph edits — the bundled preset is authoritative on
  every launch (read-only session).

### The annotate preset

- R8. The preset is one bundled `PersistedDoc` capturing both the node graph and
  its saved stage layout, authored in the dev server and exported.
- R9. Its graph is: `obs` → `Wrangle` → `Table` + `Count`; `Wrangle` → `Scatter`
  (phate) → lasso → `Cache` (the working set) → `Annotate`; `Idetik` + `Gallery`
  render crops for the cached scope.
- R10. It opens to the tiled dashboard layout (Scatter / Idetik / Gallery / Table
  / Annotate), not the node canvas.

---

## Key Flow

- F1. Frozen launch.
  - **Trigger:** `ndea <config> [--preset annotate]` on a shipped build.
  - **Steps:** server resolves the named preset (or the default annotate) → the
    name rides `/data/metadata.json` → the frontend load-or-seed path loads the
    bundled preset `PersistedDoc` through validate/migrate → the saved stage
    layout opens → authoring affordances are absent because `import.meta.env.DEV`
    is false.
  - **Outcome:** a frozen annotate dashboard the user operates but can't
    restructure.
  - **Covers:** R1–R7, R10.

---

## Scope Boundaries

### Deferred for later

- The `--dev` in-build authoring escape hatch — revisit when the node system
  stabilizes; then swap the compile-time gate for a runtime flag.
- Plan v2's per-preset scratch, "reset to preset," editable allow-list, and
  dev-in-flux warning — unneeded while builds are read-only.
- Multiple presets — near-term ships only `annotate` (as the default); the
  registry starts effectively single-entry.

### Outside this feature

- Remote/fetched presets, a preset marketplace, and a preset-manager UI.
- Supernode / composable / nested presets (Plan v2's "later" layer).
- Editing a preset inside a build — presets are authored in the dev server and
  exported; builds never author.

---

## Dependencies / Assumptions

- Builds on Plan v2 (`.design/preset-replay-plan.md`): flat-locked-preset shape,
  the load-or-seed seam, `PersistedDoc` + `validateDoc` + `migrate`.
- No preset or dev-gate infra exists yet (verified) — all net-new but small. The
  dev signal (`import.meta.env.DEV`) already exists and is used in the frontend.
- Assumes the preset `PersistedDoc`'s captured stage layout reproduces the image-1
  dashboard on load (the stage tree / placement / disposition persist in `WsState`).
- Assumes the annotate graph (R9) is authored once in dev and its exported doc is
  the shipped source of truth.

---

## Outstanding Questions

### Deferred to planning

- CLI surface details: `--preset` on the `view` command plus honoring a `preset:`
  YAML field (Plan v2 decision 5).
- How the preset doc is authored → exported to JSON: a dev "export preset"
  affordance vs. a hand-committed doc.
- Whether the node canvas is reachable at all in a build (fully hidden vs.
  read-only viewable). Default assumption: the dashboard is the only user-facing
  surface.
- A `Preset: annotate 🔒` badge in the chrome (Plan v2 signalling) — include or
  defer at planning.

---

## Sources / Research

- Prior design: `.design/preset-replay-plan.md` (Plan v2),
  `.design/preset-replay-research-report.md`.
- Verified grounding: dev gate `import.meta.env.DEV` already used
  (`src/frontend/core/workspace/workspace-context.tsx`,
  `src/frontend/dashboard/DashboardProvider.tsx`); authoring surfaces
  (`src/frontend/core/workspace/canvas/WorkspaceCanvas.tsx` Tab + AddNodeMenu,
  `src/frontend/core/workspace/workspace-store.ts` `addNode`); load-or-seed
  (`workspace-context.tsx`); persist/validate/migrate
  (`src/frontend/core/workspace/persist.ts`); config wire — frontend reads
  `/data/metadata.json`, not the legacy `/api/config`
  (`src/server/routes/config.ts`). No `--preset`/`presets.json`/preset reader
  exists yet.
