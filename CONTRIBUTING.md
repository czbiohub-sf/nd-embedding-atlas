# Contributing

## Prerequisites

- **Python 3.12--3.13** (managed with [uv](https://docs.astral.sh/uv/))
- **[pnpm](https://pnpm.io/)** -- fast Node.js package manager; requires Node.js (load with `module load nodejs` on HPC, or install via [nvm](https://github.com/nvm-sh/nvm))
- **[vite-plus](https://viteplus.dev/guide/)** -- unified frontend toolchain providing the `vp` CLI (build, lint, fmt, dev); installed automatically by `pnpm install`
- **[mise](https://mise.jdx.dev/)** -- polyglot dev tool manager used to run the combined backend + frontend dev stack (`mise run dev`)
- **[prek](https://github.com/j178/prek)** -- Git hook runner (`uvx prek`)

## Setup

```bash
git clone https://github.com/czbiohub-sf/nd-embedding-atlas.git
cd nd-embedding-atlas
uv sync --all-groups
cd frontend && pnpm install && vp build && cd ..
```

## Development workflow

```bash
# Lint + format (Python + frontend)
uvx prek

# Run tests
uv run pytest

# Launch viewer — backend + frontend dev server together
mise run dev data/annotations_zv3.zarr

# Rebuild frontend only (after component changes)
cd frontend && vp build
```

## Code style

- **Python** -- enforced by [Ruff](https://docs.astral.sh/ruff/) (config in `pyproject.toml`)
- **Frontend** -- enforced by [Oxlint](https://oxc.rs/docs/guide/usage/linter.html) + [Oxfmt](https://oxc.rs/docs/guide/usage/formatter.html) (config in `frontend/oxlint.json` and `frontend/vite.config.ts`)
- **Git hooks** -- run via [prek](https://github.com/j178/prek) (`uvx prek`)

## Full guide

See the [contributing docs](https://czbiohub-sf.github.io/nd-embedding-atlas/contributing/) for detailed conventions, project structure, and CI details.
