# nd-embedding-atlas

Interactive browser-based dashboard linking AI embeddings to source 5D (TCZYX) image data.
Early-stage — APIs are in flux.

## Stack

- **Bun** runtime + package manager (no Node.js, no Python)
- **Vite+** (`vp`) unified toolchain — lint, fmt, test, build
- **TypeScript 6** strict mode
- **axial** vendored zarr I/O — reads AnnData, MuData, OME-Zarr via zarrita + Bun Workers
- **duckdb** native — analytical queries, Arrow IPC, Mosaic query protocol
- **@uwdata/flechette** — Arrow columnar (pure JS, 14KB)
- **@uwdata/mosaic-\*** — cross-filter analytics
- **Bun.serve** — HTTP + WebSocket server (replaces FastAPI)
- **React 19 + Vite 8 + TypeGPU v0.10** custom WebGPU scatter frontend (`frontend/`)
- **TanStack** Query, Store, Pacer, Table, Virtual, Hotkeys

## Project layout

```text
src/
  index.ts            # Public API re-exports
  axial/              # Vendored zarr I/O library
    conventions/      # AnnData, MuData, OME-Zarr, xarray parsers
    core/             # Types, Arrow conversion, categoricals, workers
    net/              # Typed binary WebSocket protocol
    store/            # axial.open() entry point
  server/             # Bun.serve HTTP server
    app.ts            # Server factory (replaces FastAPI create_app)
    routes/           # Route handlers (mosaic, obs, embeddings, etc.)
  cli/                # CLI entry point
    index.ts          # Arg parsing, config, server launch
frontend/             # React + Vite + Mosaic custom dashboard
  src/
    components/       # scatter, table, charts, toolbar, viewer, layout
    dashboard/        # DashboardContext/Provider/Shell
    hooks/            # useDashboard, useColumnTypes, useMosaicClient, etc.
    stores/           # BrushPredicateStore, SelectionSyncStore, ViewSyncStore
    scatter-gpu/      # TypeGPU/WebGPU scatter renderer + hooks
    lib/              # mosaic-helpers, chart-spec, category-column
```

## Module dependency graph

```text
cli/index      ──→  axial.open(), server/app
server/app     ──→  server/routes/*, axial (DataTree), duckdb
server/routes  ──→  duckdb (Arrow IPC + Mosaic query protocol)
axial          ──→  zarrita, flechette, ndarray, Bun Workers
```

## Key abstractions

### axial (`src/axial/`)

Vendored from ~/Dev/axial/. Labeled N-D array library for zarr stores.

- `open(path)` — auto-detect convention (AnnData, MuData, OME-Zarr, xarray)
- Parallel Worker reads for obs/var DataFrames (42x speedup on local filesystem)
- `toArrowTable()` — convert obs/var to Arrow columnar for DuckDB ingestion
- Convention parsers detect store format from root `.zattrs`

### Server (`src/server/`)

- `createApp()` — Bun.serve factory, wires routes + DuckDB + static serving
- Mosaic query protocol at `/data/query` — returns Arrow IPC, JSON, or exec
- REST endpoints: `/api/embeddings/*`, `/api/obs/*`, `/api/scatter/*`, etc.
- EmbeddingStore — DuckDB with `obs_base` table + per-embedding VIEW

### Frontend (`frontend/`)

- WebGPU scatter via TypeGPU v0.10 — instanced quads, GPU-side lasso/marquee selection
- Mosaic cross-filter: scatter + table + charts driven by server-side DuckDB queries
- TanStack Store singletons bridge React ↔ Mosaic: `BrushPredicateStore` (selection),
  `SelectionSyncStore` (cross-panel), `ViewSyncStore` (pan/zoom lock)

## Commands

```zsh
# Full dev stack (backend + frontend concurrently)
mise run dev /path/to/data.zarr

# Or separately:
bun run src/cli/index.ts view /path/to/data.zarr   # backend on :5055
cd frontend && vp dev                                # frontend dev server

# Sync all dependencies
mise run sync                     # bun install + frontend install
bun install                       # backend only

# Build frontend
cd frontend && vp build

# Build single binary
bun build ./src/cli/index.ts --compile --outfile dist/ndea

# Quality gates
vp check                          # backend: typecheck + Oxlint + Oxfmt
cd frontend && vp check            # frontend: typecheck + Oxlint + Oxfmt
vp test                            # vitest
```

## Code style

Backend: Oxlint + Oxfmt via `vp check` (config in `vite.config.ts`).
Frontend: Oxlint + Oxfmt via `vp check` (config in `frontend/vite.config.ts`).

- **TypeScript strict** — no implicit any
- **`import type`** for type-only imports (`verbatimModuleSyntax`)
- **4-space indent** (Oxfmt default)
- **Double quotes**, trailing commas, semicolons
- **`@/` path alias** → `src/`

## Gotchas

- **DuckDB RecordBatchReader**: `result.arrow()` returns `RecordBatchReader` not `Table` in duckdb >= 1.4 — handle both.
- **Mosaic preagg tables**: Frontend creates `CREATE TABLE mosaic.preagg_*` — SQL filter must allow these.
- **VIEW schema caching**: `ALTER TABLE obs_base ADD COLUMN` invalidates DuckDB VIEW schema; `_rebuild_view()` handles this on embedding registration.
- **Worker URL in compiled binary**: `new URL("./column-worker.ts", import.meta.url)` must resolve in both dev and `bun build --compile`. Bun embeds Workers automatically.
- **Frontend static serving**: Dev reads from `frontend/dist/` on disk. Compiled binary reads from `$bunfs/` embedded filesystem. Same `Bun.file()` API, different backing.
- **Native .node addon**: `duckdb.node` (~53MB) embeds in compiled binary but prevents cross-compilation. Must build per-platform.

## Key decisions

- **Bun single binary** — zero-dependency distribution, `bun build --compile`
- **axial for zarr I/O** — replaces Python anndata + zarr + dask
- **Native DuckDB** (not WASM) — full speed, no 4GB memory ceiling
- **Bun.serve** (no framework) — raw fetch handler, simple route dispatch
- **Custom React + Vite + TypeGPU frontend** — full control over WebGPU scatter
- **Server-side DuckDB** — Mosaic cross-filter, avoids browser memory limits

## Resources

- [Mosaic](https://github.com/uwdata/mosaic) — cross-filtered visualization framework
- [TypeGPU](https://typegpu.com) — type-safe WebGPU library used by the scatter renderer
- [idetik](https://github.com/chanzuckerberg/idetik) — spatial layer rendering
- [Bun single-file executable](https://bun.com/docs/bundler/executables)
