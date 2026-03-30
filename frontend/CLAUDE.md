# nd-embedding-atlas frontend

React 19 + Vite 8 + TypeGPU/WebGPU scatter + Mosaic DuckDB analytics.

## Environment detection

```bash
which vp      # Vite+ unified CLI (preferred)
which pnpm    # standard dev environment
npx pnpm ...  # HPC / no global installs
```

## Commands

### Preferred: Vite+ (`vp`)

```bash
vp dev              # dev server (proxies /api /data /plate → localhost:5055)
vp build            # production build via Rolldown
vp check            # typecheck + Oxlint + Oxfmt in one pass
vp check --fix      # auto-fix lint + format
vp install          # install dependencies
vp add <pkg>        # add a dependency
```

### Fallback: pnpm

```bash
pnpm install && pnpm dev    # install + start dev server
pnpm build                  # production build
pnpm exec tsc --noEmit      # typecheck only
```

### HPC / restricted: npx pnpm

```bash
npx pnpm install
npx pnpm dev
npx pnpm exec tsc --noEmit
```

## Python backend

The frontend proxies all `/api`, `/data`, and `/plate` requests to FastAPI on port 5055.

```bash
uv run ndea view path/to/data.zarr   # start backend
mise run dev path/to/data.zarr       # start both concurrently
```

## Stack

- **Vite 8 + Rolldown** — bundler (via `vite-plus` package)
- **React 19 + TypeScript 6** — UI framework
- **TypeGPU v0.10** — type-safe WebGPU scatter rendering (`scatter-gpu/`)
- **Mosaic** — cross-filter analytics via server-side DuckDB queries
- **TanStack** — Query (caching), Store (cross-component state), Pacer (throttle/debounce), Table + Virtual, Hotkeys
- **Tailwind v4** — utility CSS; design tokens defined in `app.css`
- **Dockview** — resizable panel layout

## Key files

```
src/
  app.css                              # design tokens (@theme) + .dark overrides
  types.ts                             # shared types: Metadata, ObsInfo, ViewState
  lib/
    branded-types.ts                   # PanelId, RowIndex branded types
    schemas.ts                         # Zod schemas for API responses
    mosaic-helpers.ts                  # stringPredicate() + Mosaic SQL helpers
  providers/
    BrushPredicateStore.ts             # TanStack Store → Mosaic brushSelection bridge
    SelectionSyncStore.ts              # cross-panel selection broadcast
    ViewSyncStore.ts                   # cross-panel pan/zoom lock
  scatter-gpu/
    gpu/                               # TypeGPU pipelines, selection, culling, shaders
    components/ScatterGPUHost.tsx      # React ↔ WebGPU boundary (imperative handle)
    hooks/
      useScatterColorState.ts          # color column, mode, palette, category mapping
      useScatterBrushSync.ts           # throttler/debouncer, Mosaic sync, broadcast
      useIsolationBridge.ts            # stable handleIsolationChange (3-ref pattern)
      useTrajectoryLoader.ts           # trajectory DuckDB query + activeIndex
      useMosaicScatterData.ts          # TanStack Query: positions + colors from backend
  components/layout/panels/
    ScatterPanel.tsx                   # scatter panel (composes the hooks above)
    TablePanel.tsx                     # obs table panel
  dashboard/
    DashboardProvider.tsx              # app-level coordinator, metadata, Mosaic setup
```

## Code style

- 2-space indent (TSX/CSS/JSON)
- Double quotes, trailing commas, semicolons (Oxfmt config in `vite.config.ts`)
- Tailwind utilities only — no raw `style={{}}` except for dynamic/computed values
- `@/` path alias → `src/`
- `import type` for type-only imports

## Gotchas

**Selection sync cascade (multi-panel):** `clearSelectionExternal()` must NOT call `onSelectionChange` — it uses a separate `onExternalClear` callback. If it called `onSelectionChange`, clearing selection in panel A notifies panel B, which re-broadcasts its own clear, which panel A reacts to, oscillating at the GPU readback rate (~20 fps). See `gpu/selection.ts` and `ScatterPanel.tsx`.

**Mosaic AsyncDispatch cancellation:** `brushSelection.update()` called from React effects gets cancelled by Mosaic's `Param.cancel('value')` when consecutive updates resolve to the same predicate. The fix is `BrushPredicateStore` (TanStack Store) → `requestAnimationFrame` → `brushSelection.update()`. Never call `brushSelection.update()` directly from a `useEffect`.

**Two-tier selection sync:** Lasso readback fires at ~20 fps. Small selections (<5000 rows) update the table via `useThrottler(50ms)`; large selections use `useDebouncer(200ms)` which also handles temp-table sync. Both run on every readback. See `useScatterBrushSync.ts`.

**GPU device exhaustion:** Each scatter panel shares one `GPUDevice` via `gpu/device-manager.ts` (ref-counted singleton). Never call `tgpu.init()` per panel — use `tgpu.initFromDevice()`. Opening 4+ panels with separate devices will crash Chrome.

**`positionKey` destroys GPU on undefined:** `ScatterGPUHost` destroys and recreates the GPU when `positionKey` changes to `undefined`. Avoid transient undefined states in the data pipeline.

## Validation checklist

- [ ] `vp check` passes with zero errors
- [ ] `vp dev` starts without console errors
- [ ] No `as any` / `as unknown as` without an explanatory comment
- [ ] No new `style={{}}` where a Tailwind utility exists
