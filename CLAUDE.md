# nd-embedding-atlas

Interactive browser-based dashboard linking AI embeddings to source 5D (TCZYX) image data.
Early-stage -- APIs are in flux.

## Stack

- **Python 3.12-3.13** only, managed with **uv** (never system python, never pip)
- **anndata** lazy backend + **zarr v3** + **zarrs** codec pipeline
- **dask** for out-of-core compute
- **duckdb** + **pyarrow** for analytical queries and Arrow IPC serialization
- **React** + **Vite** + **Mosaic** custom frontend (`frontend/`)
- **FastAPI** + **uvicorn** for serving
- **iohub** for OME-Zarr 5D image access (not used)
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

Dict-like container mapping string keys to zarr stores. Internally calls
`ad.concat` lazily with `label="_dataset"` and `index_unique="-"`.

- `collection["name"] = "path/to/data.zarr"` -- coerces to `DatasetEntry` via `read_lazy`
- `.obs` returns `Dataset2D` (lazy). Call `.to_memory()` to get a pandas DataFrame.
- `.obsm["X_umap"]` returns a dask array. Call `.compute()` to materialize to numpy.
- `.X`, `.layers` -- also dask-backed
- `_dataset` column is added automatically by concat
- Cache invalidated on add/remove. Not thread-safe.

### vz module

- `vz.prepare_obs(collection, *, obs_columns)` -- materializes obs metadata (no embeddings) to DataFrame
- `vz.create_app(collection, *, obs_columns, plate_path, static_dir)` -- builds FastAPI app with lazy embedding loading
- `vz.serve(collection, *, obs_columns, plate_path, static_dir, host, port)` -- shortcut for create_app + uvicorn.run
- `EmbeddingStore` -- manages DuckDB with obs_base table + per-embedding tables joined via VIEW
- Embeddings loaded on demand via `POST /api/embeddings/{key}`, polled via `GET /api/embeddings/{key}/status`
- Mosaic query protocol at `/data/query` (GET/POST) -- returns Arrow IPC, JSON, or exec
- DuckDB `result.arrow()` returns `RecordBatchReader` (not `Table`) in duckdb >= 1.4 -- handle both types

### Frontend (`frontend/`)

- Custom React + Vite dashboard, built with `cd frontend && pnpm build`
- `frontend/dist/` is bundled into the wheel at `nd_embedding_atlas/_frontend/` via hatch build hook
- Runtime resolution order: `frontend/dist/` (dev) → `nd_embedding_atlas/_frontend/` (wheel) → error
- Uses Mosaic for cross-filtered scatter + table + charts via DuckDB queries
- Dockview for panel layout; custom viewer components for OME-Zarr image crops

## Commands

```zsh
# Install all dependency groups
uv sync --all-groups

# Launch viewer (ndea is a short alias for nd-embedding-atlas)
uv run ndea view /path/to/data.zarr --plate /path/to/plate.zarr

# Build frontend (required before serving)
cd frontend && pnpm install && pnpm build

# Build wheel (auto-builds frontend via hatch hook if dist/ missing)
uv build

# Run python scripts/code
uv run python script.py

# Lint + format
uvx prek

# Run tests
uv run pytest

# Sync lockfile after changing pyproject.toml
uv lock

# Docs
uv run zensical serve   # live preview
uv run zensical build   # static site
```

## Code style

Enforced by ruff (config in `pyproject.toml`) and prek hooks (`uvx prek`).

- **Line length**: 120
- **Docstrings**: numpy convention (`Parameters`, `Returns`, etc.)
- **Imports**: sorted by isort (ruff `I` rule), stdlib -> third-party -> local
- **`from __future__ import annotations`** in new files
- **`TYPE_CHECKING`** guard for imports only needed for type hints
- **Private modules** prefixed with `_` (e.g. `_prepare.py`, `_serve.py`)
- **Public API** re-exported from `__init__.py`
- **Keyword-only params** after the first positional arg: `def f(data, *, key="default")`
- **Error messages**: assign to `msg` variable, then `raise ValueError(msg)` (TRY003 rule)
- **No bare string raises**: always use exception classes
- **f-strings** preferred over `.format()` or `%`
- **pathlib.Path** over os.path (PTH rules enabled)
- **Indentation**: 4 spaces (Python), 2 spaces (YAML/TOML/TSX)

### Prek hooks (run via `uvx prek`)

1. biome-check (TS/TSX/CSS/JSON — lint + format, config in `biome.jsonc`)
2. pyproject-fmt
3. ruff-check + ruff-format (Python, Jupyter)
4. detect-private-key, check-ast, end-of-file-fixer, trailing-whitespace

### Ruff rules enabled

B, BLE, C4, D, E, F, I, NPY, PD, PERF, PT, PTH, RUF, TID, TRY, UP, W

## Testing

- **pytest** with `--import-mode=importlib`
- Fixtures in `tests/conftest.py`
- Test data: run `uv run scripts/download_dynaclr_datasets.py` to download to `data/`
- CI runs via hatch test matrix: Python 3.12 + 3.13 stable, 3.13 pre-release
- Coverage reported to Codecov

## Patterns to follow

### Lazy data duck-typing

```python
# obsm values may be dask arrays or numpy -- use hasattr
coords = collection.obsm[key]
if hasattr(coords, "compute"):
    coords = coords.compute()

# obs may be Dataset2D or DataFrame -- use hasattr
obs = collection.obs
if hasattr(obs, "to_memory"):
    obs = obs.to_memory()
```

### Scripts in `scripts/`

- Use **typer** for CLI argument parsing
- **Lazy imports** inside the command function (keeps `--help` fast)
- Use **rich** for progress bars and styled console output
- Entry point: `if __name__ == "__main__": app()`

### Zarr initialization boilerplate

Any script touching zarr directly needs:

```python
import zarr
import zarrs  # noqa: F401
zarr.config.set({"codec_pipeline.path": "zarrs.ZarrsCodecPipeline"})
```

This is already handled inside `AnnDataCollection` -- only needed in standalone scripts.

### DuckDB Arrow IPC serialization

DuckDB >= 1.4 returns `RecordBatchReader` from `result.arrow()`, not `Table`. Handle both:

```python
arrow = result.arrow()
sink = pa.BufferOutputStream()
if isinstance(arrow, pa.Table):
    with pa.ipc.new_stream(sink, arrow.schema) as writer:
        writer.write(arrow)
else:
    with pa.ipc.new_stream(sink, arrow.schema) as writer:
        for batch in arrow:
            writer.write_batch(batch)
```

### Versioning

Single source of truth: git tags → `uv-dynamic-versioning` → `importlib.metadata.version("nd-embedding-atlas")`.

- Python: `importlib.metadata.version("nd-embedding-atlas")`
- Frontend: fetched at runtime via `/data/metadata.json` `version` field
- `package.json` version is a placeholder — frontend is never published to npm

### DuckDB VIEWs and schema invalidation

- `EmbeddingStore` uses a `dataset` VIEW that JOINs `obs_base` with `emb_*` tables
- After `ALTER TABLE obs_base ADD COLUMN`, must `CREATE OR REPLACE VIEW dataset` to avoid stale schema
- The `_rebuild_view()` method handles this automatically when registering embeddings

## Gotchas

- **Frontend resolution**: Dev uses `frontend/dist/`; wheel uses bundled `nd_embedding_atlas/_frontend/`. If neither exists, `_resolve_frontend()` raises with instructions.
- **Hatch build hook**: `hatch_build.py` runs `pnpm build` during `uv build` if `frontend/dist/` is missing. Requires `pnpm` on PATH.
- **DuckDB RecordBatchReader**: `result.arrow()` returns `RecordBatchReader` not `Table` in duckdb >= 1.4
- **Mosaic preagg tables**: Frontend creates `CREATE TABLE mosaic.preagg_*` -- SQL filter must allow these
- **VIEW schema caching**: DuckDB VIEWs cache column types; `ALTER TABLE` on underlying table invalidates cached schema
- **Ruff S608**: SQL injection rule is NOT in the enabled ruleset -- don't add `# noqa: S608`

## Key decisions

- **Custom React + Vite + Mosaic frontend** -- full control over linked scatter/table/charts; Dockview panels
- **Hatch build hook + `force-include`** -- auto-builds frontend during `uv build`; bundles into wheel at `nd_embedding_atlas/_frontend/`
- **Server-side DuckDB** (not WASM) -- more reliable for large datasets, avoids browser memory limits
- **Inline pyarrow IPC** (no embedding-atlas Python dep) -- removed heavy transitive deps (torch, sentence-transformers)
- **zarrs Rust codec** -- faster read/write than default Python codecs
- **Zarr v3 with sharding** (via annbatch) -- better cloud access patterns

## Resources

### Recommended skills

- [vercel-react-best-practices](https://skills.sh/vercel-labs/agent-skills/vercel-react-best-practices)
- [vercel-composition-patterns](https://skills.sh/vercel-labs/agent-skills/vercel-composition-patterns)
- [web-design-guidelines](https://skills.sh/anthropics/skills/web-design-guidelines)
- [frontend-design](https://skills.sh/anthropics/claude-plugins-official/frontend-design)
- [claude-md-improver](https://skills.sh/anthropics/claude-plugins-official/claude-md-improver)

### Relevant Packages

- [embedding-atlas](https://github.com/apple/embedding-atlas) -- Apple's WebGL scatter/table viewer (original inspiration, no longer a Python dependency)
- [idetik](https://github.com/chanzuckerberg/idetik) -- Idetik
- [idetik-react](https://github.com/chanzuckerberg/idetik-react): -- Idetik React
- [Mosaic](https://github.com/uwdata/mosaic) -- Cross-filtered visualization framework used by the frontend
