---
icon: lucide/git-pull-request
---

# Contributing

## Development setup

### Prerequisites

- **Python 3.12--3.13** (managed with [uv](https://docs.astral.sh/uv/))
- **[pnpm](https://pnpm.io/)** -- fast Node.js package manager; requires Node.js (load with `module load nodejs` on HPC, or install via [nvm](https://github.com/nvm-sh/nvm))
- **[vite-plus](https://viteplus.dev/guide/)** -- unified frontend toolchain providing the `vp` CLI; installed automatically by `pnpm install`
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
cd frontend && pnpm install && vp build
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

Enforced by [Oxlint](https://oxc.rs/docs/guide/usage/linter.html) + [Oxfmt](https://oxc.rs/docs/guide/usage/formatter.html) via vite-plus.
Config lives in `frontend/oxlint.json` and the `lint:` / `fmt:` sections of `frontend/vite.config.ts`.

## Linting and formatting

``` bash
uvx prek # (1)!
```

1. Runs all pre-commit hooks: Oxlint + Oxfmt (TS/TSX), pyproject-fmt,
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
    vp lint --fix src
    vp fmt --write src
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
vp dev   # (1)!
vp build # (2)!
```

1. Starts the dev server with hot reload. The Python backend must be running separately.
2. Production build → `frontend/dist/`.

Full dev stack (backend + frontend together):

``` bash
mise run dev data/annotations_zv3.zarr
```

## Project structure

``` text
src/nd_embedding_atlas/
  cli/          # Typer CLI — auto-detects AnnData / OME-Zarr / YAML config
  io/           # AnnDataCollection, fast zarr readers, ProjectConfig YAML model
  ndimg/        # OME-Zarr standalone viewer (metadata + FastAPI app)
  server/       # Main FastAPI app, EmbeddingStore (DuckDB), route modules
  vz/           # obs materialisation, spatial column detection, zarr export

frontend/src/
  scatter-gpu/  # TypeGPU/WebGPU scatter renderer — pipelines, shaders, selection
  components/   # React panels: scatter, viewer, table, charts, toolbar, layout
  dashboard/    # App-level DashboardProvider + DashboardContext
  stores/       # TanStack Store singletons (selection, view sync, brush predicate)
  hooks/        # Generic hooks (useMosaicClient, useDashboard, etc.)
  lib/          # Utilities (mosaic-helpers, color-source, schemas, etc.)

scripts/        # Standalone data-prep scripts (typer + rich)
tests/          # pytest
```


## Common commands

| Command | Description |
|---------|-------------|
| `uv sync` | Install dependencies |
| `uv run pytest` | Run tests |
| `uvx prek` | Lint + format (all pre-commit hooks) |
| `ndea <paths>` | Launch the viewer |
| `mise run dev <path>` | Full dev stack (backend + frontend) |
| `uv build` | Build wheel (auto-builds frontend) |
| `cd frontend && vp build` | Rebuild frontend only |
| `uv run zensical serve` | Preview docs locally (live reload) |
| `uv run zensical build` | Build static docs site |

## Versioning

The frontend reads the version at runtime from `/data/metadata.json` -- no build-time sync needed.
`package.json` version is a placeholder (not published to npm).
