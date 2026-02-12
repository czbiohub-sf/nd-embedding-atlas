---
icon: lucide/git-pull-request
---

# Contributing

## Development setup

### Prerequisites

- **Python 3.12--3.13** (managed with [uv](https://docs.astral.sh/uv/))
- **[pnpm](https://pnpm.io/)** for frontend builds
- **[prek](https://github.com/j178/prek)** for Git hooks (`uvx prek`)

### Clone and install

``` bash
git clone https://github.com/czbiohub-sf/nd-embedding-atlas.git
cd nd-embedding-atlas
uv sync --all-groups # (1)!
```

1. Installs all dependency groups: main, dev, test, and doc.

### Build the frontend

``` bash
cd frontend && pnpm install && pnpm build
cd ..
```

!!! warning "Frontend must be built before serving"

    The Python server resolves static files from `frontend/dist/`. If it doesn't
    exist, you'll get a `FileNotFoundError` with instructions.

## Code style

### Python

Enforced by [Ruff](https://docs.astral.sh/ruff/) (config in `pyproject.toml`).

Function signatures use keyword-only params after the first positional arg:

``` python
def prepare_obs(collection, *, obs_columns=None): ...
```

Error messages go through a `msg` variable:

``` python
msg = f"Unknown key: {key}"
raise ValueError(msg)
```

### Frontend

Enforced by [Biome](https://biomejs.dev/) (config in `biome.jsonc`).

## Linting and formatting

``` bash
uvx prek # (1)!
```

1. Runs all pre-commit hooks: Biome (TS/TSX/CSS/JSON), pyproject-fmt,
   Ruff check + format, private key detection, AST checks, whitespace fixes.

Or run tools individually:

=== "Python"

    ``` bash
    uv run ruff check --fix src tests
    uv run ruff format src tests
    ```

=== "Frontend"

    ``` bash
    cd frontend
    pnpm lint:fix
    pnpm format
    ```

## Testing

``` bash
uv run pytest # (1)!
```

1. Uses `--import-mode=importlib` (configured in `pyproject.toml`).

Tests live in `tests/` with fixtures in `tests/conftest.py`.

### CI test matrix

The CI runs via [Hatch](https://hatch.pypa.io/) across:

| Python | Dependencies |
|--------|-------------|
| 3.12 | Stable |
| 3.13 | Stable |
| 3.13 | Pre-release (non-blocking) |

## Frontend development

``` bash
cd frontend
pnpm dev   # (1)!
pnpm build # (2)!
```

1. Starts Vite dev server with hot reload. Useful for iterating on components
   without restarting the Python backend.
2. TypeScript check + Vite production build &rarr; `frontend/dist/`.

After any frontend changes, rebuild before serving:

``` bash
pnpm build && cd .. && uv run ndea view data/annotations_zv3.zarr
```

## Project structure

``` text
src/nd_embedding_atlas/
  __init__.py         # Re-exports: cli, io, vz; sets zarrs codec
  _frontend/          # Bundled frontend (auto-built, gitignored)
  cli/_app.py         # Typer CLI entry point
  io/collection.py    # AnnDataCollection core abstraction
  vz/
    _prepare.py       # Materialize obs metadata
    _duckdb.py        # EmbeddingStore + Mosaic query endpoints
    _serve.py         # FastAPI app factory + static file serving
frontend/             # React + Vite + Mosaic dashboard
scripts/              # Standalone CLI scripts (typer + rich)
tests/                # pytest
```

### Module dependency graph

``` mermaid
graph LR
  cli._app --> io.collection
  cli._app --> vz._serve
  vz._prepare --> io.collection
  vz._duckdb --> vz._prepare
  vz._serve --> vz._duckdb
  vz._serve --> vz._prepare
  io.collection --> anndata & zarr & dask
```

## Scripts

Scripts in `scripts/` follow these conventions:

- **typer** for CLI argument parsing
- **Lazy imports** inside the command function (keeps `--help` fast)
- **rich** for progress bars and styled output
- Entry point: `if __name__ == "__main__": app()`

Standalone scripts that touch zarr directly are recommended to use zarrs-python codec as it helps speed up I/O:

``` python
import zarr
import zarrs  # noqa: F401
zarr.config.set({"codec_pipeline.path": "zarrs.ZarrsCodecPipeline"})
```

## Common commands

| Command | Description |
|---------|-------------|
| `uv sync` | Install dependencies |
| `uv run pytest` | Run tests |
| `uvx prek` | Lint + format (all pre-commit hooks) |
| `uv run ndea view <paths>` | Launch the viewer |
| `uv build` | Build wheel (auto-builds frontend) |
| `cd frontend && pnpm build` | Rebuild frontend |
| `uv run zensical serve` | Preview docs locally (live reload) |
| `uv run zensical build` | Build static docs site |

## Versioning

Single source of truth: **git tags** &rarr; `uv-dynamic-versioning` &rarr; `importlib.metadata.version("nd-embedding-atlas")`.

The frontend reads the version at runtime from `/data/metadata.json` -- no build-time sync needed.
`package.json` version is a placeholder (not published to npm).
