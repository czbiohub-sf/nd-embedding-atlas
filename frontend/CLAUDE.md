# nd-embedding-atlas frontend

React + Vite + TypeGPU/WebGPU scatter plots + Mosaic DuckDB analytics.

## Environment detection

The toolchain adapts based on what's available. Check before running commands:

```bash
which vp      # Vite+ unified CLI (preferred when available)
which pnpm    # direct pnpm (standard dev environment)
npx pnpm ...  # HPC / restricted environments — no global pnpm install
```

## Commands

### Preferred: Vite+ (`vp`)

If `vp` is available, use it for everything — it wraps pnpm, Rolldown, Oxlint, Oxfmt, and TypeScript in one CLI:

```bash
vp dev              # dev server (proxies /api, /data, /plate → localhost:5055)
vp build            # production build via Rolldown
vp check            # typecheck + lint (Oxlint) + format (Oxfmt) — one command
vp check --fix      # auto-fix lint + format issues
vp lint             # Oxlint only
vp fmt              # Oxfmt only
vp install          # install dependencies (wraps pnpm)
vp add <pkg>        # add a dependency
```

### Fallback: pnpm directly

When `vp` is not installed:

```bash
pnpm install        # install dependencies
pnpm dev            # dev server
pnpm build          # production build (runs tsc + vp build, falls back to vite build)
pnpm check          # vp check if available, else tsc --noEmit
pnpm lint           # vp lint if available, else biome check
```

### HPC / restricted: npx pnpm

On HPC clusters or environments where global installs are not permitted:

```bash
npx pnpm install    # install dependencies
npx pnpm dev        # dev server
npx pnpm build      # production build
npx pnpm exec tsc --noEmit   # typecheck
```

## Python backend

The frontend proxies all API calls to a FastAPI/uvicorn backend on port 5055.
Start the backend with `uv run ndea view <data.zarr>` from the repo root.

Or use mise to start both together:

```bash
mise run dev path/to/data.zarr   # backend + frontend concurrently
```

## Stack

- **Vite 8 + Rolldown** — bundler (via `vite-plus` package)
- **React 19 + TypeScript 6** — UI
- **TypeGPU v0.10** — type-safe WebGPU scatter rendering
- **Mosaic** — cross-filter analytics via server-side DuckDB
- **TanStack** — Query, Store, Pacer, Table, Virtual, Hotkeys
- **Tailwind v4** — utility CSS with custom design tokens in `app.css`
- **Dockview** — resizable panel layout

## Key files

```
src/
  app.css                          # design tokens (@theme) + dark mode overrides
  scatter-gpu/                     # WebGPU scatter renderer
    gpu/                           # pipelines, selection, culling, shaders
    hooks/                         # useScatterColorState, useScatterBrushSync, etc.
  components/layout/panels/        # ScatterPanel, TablePanel, ImageViewerPanel
  providers/                       # BrushPredicateStore, SelectionSyncStore, ViewSyncStore
  dashboard/                       # DashboardContext/Provider/Shell
```

## Code style

- 2-space indent for TSX/CSS, 4-space for Python
- Double quotes, trailing commas, semicolons (`fmt` block in vite.config.ts)
- Tailwind utilities only — no inline `style={{}}` except for dynamic values
- `@/` path alias → `src/`

## Validation checklist

- [ ] `vp check` (or `pnpm exec tsc --noEmit`) passes with zero errors
- [ ] `vp dev` starts without console errors
- [ ] No `as any` / `as unknown as` casts introduced without a comment explaining why
