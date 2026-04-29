# Fallow Audit — bun-binary @ 0867d63

Worktree: `~/Biohub/nd-embedding-atlas.fallow-audit` (branch `fallow-audit`, base `bun-binary`)
Tools: `fallow dead-code`, `fallow dupes`, `fallow health` (raw JSON in `/tmp/fallow-*.json`)
Health score: **81.9 / 100 (B)** — penalties: complexity 5.0, unused-deps 4.0, circular-deps 3.0, dead-files 2.9, dead-exports 2.6.

---

## Headline numbers

| Metric                                      |         Value |
| ------------------------------------------- | ------------: |
| Total dead-code issues                      |           406 |
| Unused files                                |            50 |
| Unused exports                              |           173 |
| Unused types                                |           127 |
| Unused class members                        |            39 |
| Duplicate exports                           |             9 |
| Circular dependencies                       |             3 |
| Functions over thresholds                   |      192/2190 |
| Critical-severity functions                 |            46 |
| Untested files                              | 236/280 (84%) |
| Duplication % (with vendored colormap data) |          5.6% |
| Avg maintainability index                   |          87.9 |

---

## 1. Circular deps (zarr layer)

```
src/zarr/anndata.ts ↔ src/zarr/open.ts
src/zarr/anndata.ts → open.ts → mudata.ts → open.ts
src/zarr/mudata.ts ↔ src/zarr/open.ts
```

Why bad: cycle of 8 fan-in dependents per `targets[].priority=41.3` for `anndata.ts`. Initialization-order risk.
Fix: extract shared types/parser dispatch into `src/zarr/types.ts` or new `_dispatch.ts`; `open.ts` should not re-import its leaf parsers.

## 2. Hot complexity (refactor candidates)

CRAP = cyclo² × (1 − cov)³ + cyclo. All five below have **zero coverage**:

| Function                      | File                                                         | cyclo | cog | LOC |   CRAP |
| ----------------------------- | ------------------------------------------------------------ | ----: | --: | --: | -----: |
| `routeApi`                    | `src/server/app.ts:222`                                      |    48 |  51 | 131 |  545.7 |
| `startup`                     | `src/cli/startup.ts:50`                                      |    34 |  46 | 273 | 1190.0 |
| `ModalityColorPicker`         | `src/frontend/components/mudata/ModalityColorPicker.tsx:86`  |    28 |  19 | 361 |  812.0 |
| `ScatterView`                 | `src/frontend/components/scatter/ScatterView.tsx:71`         |    28 |  18 | 492 |  812.0 |
| `BottomDock`                  | `src/frontend/components/layout/BottomDock.tsx:89`           |    24 |  18 | 350 |  600.0 |
| `appendArrowValue`            | `src/zarr/duckdb-ingest.ts:198`                              |    22 |  33 |   ~ |  126.5 |
| `createScatterplot`           | `src/frontend/scatter-gpu/gpu/orchestrator.ts:16`            |    14 |   6 | 474 |  210.0 |
| `createInteractionController` | `src/frontend/scatter-gpu/hooks/useScatterInteraction.ts:25` |    17 |   8 | 435 |  306.0 |

`routeApi` and `startup` carry the full backend/CLI dispatch — split by route family / startup phase. The four React components above are the canonical "god-component" smell: 28+ branches each, all rendering paths untested. Easiest CRAP wins are `handleObsInfo` (`server/routes/obs.ts:79`, cyclo 31, **cov tier high** → already crap 34.2) — those are fine to leave.

## 3. Worst-maintainability files (Halstead/MI)

|   MI | LOC | cyclo | File                                                      |
| ---: | --: | ----: | --------------------------------------------------------- |
| 62.1 | 116 |    52 | `src/frontend/ochre/normalize/index.ts`                   |
| 65.9 | 106 |    22 | `src/frontend/components/crops/CropHoverCard.tsx`         |
| 66.2 | 116 |    25 | `src/frontend/ochre/gpu/linear-colormap.ts`               |
| 67.0 | 212 |    29 | `src/frontend/components/scatter/ScatterControlStrip.tsx` |
| 68.9 |  95 |    12 | `src/frontend/components/StatusFooter.tsx`                |
| 69.6 |  82 |    16 | `src/frontend/hooks/useMosaicQuery.ts`                    |

Many of these (`StatusFooter`, `StatusBar`, `FilterInfo`, `ExportButton`, `CropHoverCard`, `useMosaicQuery`, `PiPButton`) are **also flagged as unused files** — delete fixes both metrics.

## 4. Dead code clusters

50 unused files split:

- **`src/frontend/ochre/`** — 21 unused (entire `ochre/colormap/{data,catalog}/{cividis,google,okabeito,petroff}.ts`, `ochre/gpu/`, `ochre/normalize/index.ts`, `ochre/index.ts`). Imported only as data, never via the public `ochre/index.ts` barrel.
- **`src/frontend/components/`** — 21 unused: 9 in `components/ui/` (callout, control-strip, filter-badge, hover-card, legend-row, pill, resizable, sheet, skeleton), `StatusBar`, `StatusFooter`, `PiPButton`, `PiPPortal`, `ScatterControlStrip`, `MultiPanelPreview`, `CropHoverCard`, the entire `toolbar/` dir (Toolbar, ExportButton, FilterInfo, TimeSlider), `viewer/CollapsibleOverlay`.
- **`src/frontend/scatter-gpu/selection/`** — 4 of 5 files unused (`DensePointSet`, `SparsePointSet`, `IPointSet`, `index.ts`). Selection rewrite landed elsewhere; old impl never deleted.
- **`src/frontend/lib/recipes.ts`**, **`hooks/useMosaicQuery.ts`**, **`hooks/usePictureInPicture.ts`**, **`stores/SelectionLayerStore.ts`**.

Also 3 `obsset` files (`useObsSets.ts`, `SaveObsSetDialog.tsx`, `ObsSetPanel.tsx`, `ObsSetStore.ts`) — already deleted in your main worktree's uncommitted state, so they'll fall off when you commit.

## 5. Unused dependencies / dev-deps (package.json)

| Package                 | Listed in       | Action                                       |
| ----------------------- | --------------- | -------------------------------------------- |
| `@uwdata/mosaic-duckdb` | dependencies    | safe to remove (server uses native duckdb)   |
| `agent-browser`         | devDependencies | unused                                       |
| `eslint-plugin-typegpu` | devDependencies | unused (project uses Oxlint, no ESLint)      |
| `shadcn`                | devDependencies | shadcn CLI — keep if you run it, else remove |

## 6. Unresolved import (will break build under strict resolver)

```
src/frontend/app.css:1  → ./shadcn/tailwind.css   (file not present)
```

## 7. Duplicate exports (same symbol re-exported from multiple files)

Real duplicates worth resolving:

- `CategoryLegendItem` — `src/frontend/lib/category-column.ts:17` **and** `src/protocol/index.ts:109`
- `CreateObsSetBody` — `src/frontend/components/scatter/useObsSets.ts:11` **and** `src/protocol/index.ts:70` (the obsset file is being deleted anyway)

Colormap-name duplicates (`HiLo`, `PRGn`, `RdBu`, `YlOrBr`, `coolwarm`, `copper`, `ice`) — same colormap defined under multiple catalog vendors. Acceptable; each catalog is its own namespace. Can be silenced or you can pick a canonical catalog in `ochre/colormap/popular.ts`.

## 8. Code clones (excluding `*.generated.ts`)

Top non-generated dupes:

| Lines × instances | Locations                                                                                                              |
| ----------------: | ---------------------------------------------------------------------------------------------------------------------- |
|            53 × 2 | `src/cli/commands/rollback.ts:29-60`, `src/cli/commands/update.ts:53-105`                                              |
|            40 × 2 | `src/frontend/components/StatusBar.tsx:21-60`, `src/frontend/components/StatusFooter.tsx:24-62` (both unused — delete) |
|            27 × 3 | `src/server/__tests__/app.test.ts` (152, 182, 382) — extract test helper                                               |
|            21 × 3 | `src/server/__tests__/app.test.ts` (287, 311, 359) — same                                                              |
|            18 × 4 | `src/server/__tests__/app.test.ts` (461/481/501) — same                                                                |
|            19 × 3 | `CommandPalette.tsx:46`, `toolbar/ExportButton.tsx:20`, `toolbar/FilterInfo.tsx:18` (latter two unused)                |
|            16 × 5 | `ochre/colormap/catalog/{imagej,matlab,matplotlib,vispy,yorick}.ts:8` — boilerplate catalog header                     |
|            32 × 2 | `src/zarr/__tests__/anndata.test.ts:144` & `:178` — extract test helper                                                |

Most `app.test.ts` clones look like setup/teardown boilerplate — pull out a `withApp(fn)` helper.

The CLI `rollback.ts` ↔ `update.ts` 53-line clone is the only real product-code dupe of consequence — they likely share manifest/install logic.

The 1345-line `*.generated.ts` clones in `cmasher`, `cmocean`, `colorcet`, `tol` are colormap data — false positives from the dupe scan; the colormaps themselves overlap, not the codegen. Add `**/*.generated.ts` to fallow `dupes.ignore` in `.fallowrc.json`.

## 9. Coverage profile

`fallow health` reports **84% of runtime files have zero static-coverage signal** (236/280) and **1585 untested exports**. Average MI is fine at 87.9 — biggest gap is the React/scatter layer where every god-component runs untested.

---

## Recommended fix order

1. **Delete unused files (50 files, mostly ochre + UI primitives + obsoleted toolbar + selection v1)** — single-PR cleanup, drops penalty by ~5.5 pts and clears half the metrics.
2. **Remove unused deps** from `package.json` (4 pkgs) — mechanical.
3. **Fix `app.css` unresolved `./shadcn/tailwind.css` import.**
4. **Break zarr cycle** (`anndata.ts ↔ open.ts ↔ mudata.ts`) — extract dispatch into a non-importing module.
5. **Extract test helpers** for `app.test.ts` and `anndata.test.ts` clones.
6. **Decompose god functions** (`routeApi`, `startup`, `ScatterView`, `BottomDock`, `ModalityColorPicker`) — biggest CRAP wins, but each is real engineering, not a sweep.
7. **Add `**/\*.generated.ts` to fallow ignore\*\* for cleaner dupe runs.

Items 1–3 are pure deletion / config; safe to bundle into one PR. Items 4–6 are real refactors and should ship separately.
