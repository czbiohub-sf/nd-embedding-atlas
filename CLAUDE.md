# nd-embedding-atlas

Interactive browser-based dashboard linking AI embeddings to source 5D (TCZYX) image data.
Early-stage — APIs are in flux.

## Stack

- **Python 3.12–3.13** only, managed with **uv** (never system python, never pip)
- **anndata** lazy backend + **zarr v3** + **zarrs** codec pipeline
- **dask** for out-of-core compute
- **duckdb** + **pyarrow** for analytical queries and Arrow IPC serialization
- **React 19 + Vite 8 + TypeGPU v0.10** custom WebGPU scatter frontend (`frontend/`)
- **Mosaic** cross-filter analytics via server-side DuckDB
- **TanStack** Query, Store, Pacer, Table, Virtual, Hotkeys
- **FastAPI** + **uvicorn** for serving
- **typer** for CLI, **rich** for terminal output

## Project layout

```text
src/nd_embedding_atlas/
  __init__.py         # Re-exports: cli, io, vz; sets zarrs codec
  _frontend/          # Bundled frontend (auto-built by hatch hook, gitignored)
  cli/
    _app.py           # Typer CLI — `nd-embedding-atlas view` command
  io/
    collection.py     # AnnDataCollection — core data abstraction
  vz/
    _prepare.py       # prepare_obs() — materialize obs metadata
    _duckdb.py        # EmbeddingStore + Mosaic query endpoints
    _serve.py         # create_app() / serve() — FastAPI app factory
frontend/             # React + Vite + Mosaic custom dashboard
  src/
    components/       # scatter, table, charts, toolbar, viewer, layout
    dashboard/        # DashboardContext/Provider/Shell
    hooks/            # useDashboard, useColumnTypes, useMosaicClient, etc.
    providers/        # BrushPredicateStore, SelectionSyncStore, ViewSyncStore
    scatter-gpu/      # TypeGPU/WebGPU scatter renderer + hooks
    lib/              # mosaic-helpers, chart-spec, category-column
scripts/              # Standalone CLI scripts (typer or plain)
tests/                # pytest
hatch_build.py        # Custom hatch build hook — builds frontend during `uv build`
```

## Module dependency graph

```text
cli._app       ──→  io.collection, vz.serve
vz._prepare    ──→  io.collection (AnnDataCollection)
vz._duckdb     ──→  duckdb, pyarrow (Arrow IPC + Mosaic query protocol)
vz._serve      ──→  vz._duckdb, vz._prepare, fastapi, uvicorn
io.collection  ──→  anndata, zarr, zarrs, dask
scripts/*      ──→  nd_embedding_atlas.io, nd_embedding_atlas.vz, typer
```

## Key abstractions

### AnnDataCollection (`io/collection.py`)

Dict-like container mapping string keys to zarr stores. Calls `ad.concat` lazily
with `label="_dataset"` and `index_unique="-"`.

- `collection["name"] = "path/to/data.zarr"` — coerces to `DatasetEntry` via `read_lazy`
- `.obs` returns `Dataset2D` (lazy); call `.to_memory()` for a pandas DataFrame
- `.obsm["X_umap"]` returns a dask array; call `.compute()` to materialize
- `_dataset` column added automatically by concat; cache invalidated on add/remove

### vz module

- `vz.prepare_obs(collection, *, obs_columns)` — materializes obs metadata to DataFrame
- `vz.create_app(collection, *, obs_columns, plate_path, static_dir)` — FastAPI app factory
- `vz.serve(...)` — shortcut for `create_app` + `uvicorn.run`
- `EmbeddingStore` — DuckDB with `obs_base` table + per-embedding tables joined via VIEW
- Embeddings loaded on demand: `POST /api/embeddings/{key}`, polled via `GET .../status`
- Mosaic query protocol at `/data/query` — returns Arrow IPC, JSON, or exec

### Frontend (`frontend/`)

- WebGPU scatter via TypeGPU v0.10 — instanced quads, GPU-side lasso/marquee selection
- Mosaic cross-filter: scatter + table + charts driven by server-side DuckDB queries
- TanStack Store singletons bridge React ↔ Mosaic: `BrushPredicateStore` (selection),
  `SelectionSyncStore` (cross-panel), `ViewSyncStore` (pan/zoom lock)
- `frontend/dist/` bundled into wheel at `nd_embedding_atlas/_frontend/` via hatch hook
- Runtime resolution: `frontend/dist/` (dev) → `nd_embedding_atlas/_frontend/` (wheel) → error

## Commands

```zsh
# Full dev stack (backend + frontend concurrently)
mise run dev /path/to/data.zarr

# Or separately:
uv run ndea view /path/to/data.zarr     # backend on :5055
cd frontend && vp dev                   # frontend dev server

# Sync all dependencies
mise run sync                           # uv sync + pnpm install
uv sync --all-groups                    # Python only

# Build frontend
cd frontend && vp build                 # or: mise run build

# Build wheel (auto-builds frontend via hatch hook if dist/ missing)
uv build

# Quality gates
mise run check                          # pytest + vp check
cd frontend && vp check                 # typecheck + Oxlint + Oxfmt
uvx prek                                # Python lint + format
uv run pytest

# Sync lockfile after changing pyproject.toml
uv lock
```

## Code style

Enforced by ruff (`pyproject.toml`) and prek hooks (`uvx prek`).
Frontend: Oxlint + Oxfmt via `vp check` (config in `frontend/vite.config.ts`).

- **Line length**: 120
- **Docstrings**: numpy convention (`Parameters`, `Returns`, etc.)
- **Imports**: sorted by isort (ruff `I` rule), stdlib → third-party → local
- **`from __future__ import annotations`** in new files
- **`TYPE_CHECKING`** guard for type-hint-only imports
- **Private modules** prefixed with `_`
- **Public API** re-exported from `__init__.py`
- **Keyword-only params** after the first positional arg: `def f(data, *, key="default")`
- **Error messages**: `msg = "..."; raise ValueError(msg)` (TRY003)
- **f-strings** over `.format()` or `%`
- **pathlib.Path** over os.path

### Prek hooks (`uvx prek`)

1. pyproject-fmt
2. ruff-check + ruff-format (Python, Jupyter)
3. detect-private-key, check-ast, end-of-file-fixer, trailing-whitespace

### Ruff rules enabled

B, BLE, C4, D, E, F, I, NPY, PD, PERF, PT, PTH, RUF, TID, TRY, UP, W

## Testing

- **pytest** with `--import-mode=importlib`
- Fixtures in `tests/conftest.py`
- Test data: `uv run scripts/download_dynaclr_datasets.py` → `data/`
- CI: hatch test matrix — Python 3.12 + 3.13 stable, 3.13 pre-release

## Gotchas

- **Frontend resolution**: dev uses `frontend/dist/`; wheel uses `nd_embedding_atlas/_frontend/`. If neither exists, `_resolve_frontend()` raises with instructions.
- **Hatch build hook**: `hatch_build.py` runs `vp build` during `uv build` if `frontend/dist/` is missing. Requires `vp` (or `pnpm`) on PATH.
- **DuckDB RecordBatchReader**: `result.arrow()` returns `RecordBatchReader` not `Table` in duckdb ≥ 1.4 — handle both.
- **Mosaic preagg tables**: Frontend creates `CREATE TABLE mosaic.preagg_*` — SQL filter must allow these.
- **VIEW schema caching**: `ALTER TABLE obs_base ADD COLUMN` invalidates DuckDB VIEW schema; `_rebuild_view()` handles this on embedding registration.
- **Zarr boilerplate**: Scripts touching zarr directly need `import zarrs; zarr.config.set({"codec_pipeline.path": "zarrs.ZarrsCodecPipeline"})`. `AnnDataCollection` handles this internally.
- **Lazy data duck-typing**: obsm values may be dask arrays or numpy — use `hasattr(x, "compute")`. obs may be `Dataset2D` or DataFrame — use `hasattr(x, "to_memory")`.

## Key decisions

- **Custom React + Vite + TypeGPU frontend** — full control over WebGPU scatter; Dockview panels; Mosaic cross-filter
- **Hatch build hook + `force-include`** — auto-builds frontend during `uv build`; bundles into wheel
- **Server-side DuckDB** (not WASM) — more reliable for large datasets, avoids browser memory limits
- **zarrs Rust codec** — faster read/write than default Python codecs
- **Zarr v3 with sharding** — better cloud access patterns

## Resources

- [Mosaic](https://github.com/uwdata/mosaic) — cross-filtered visualization framework
- [TypeGPU](https://typegpu.com) — type-safe WebGPU library used by the scatter renderer
- [embedding-atlas](https://github.com/apple/embedding-atlas) — original inspiration (no longer a dependency)
- [idetik](https://github.com/chanzuckerberg/idetik) — spatial layer rendering
