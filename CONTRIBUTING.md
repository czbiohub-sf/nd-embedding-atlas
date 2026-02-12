# Contributing

## Setup

```bash
git clone https://github.com/czbiohub-sf/nd-embedding-atlas.git
cd nd-embedding-atlas
uv sync --all-groups
cd frontend && pnpm install && pnpm build && cd ..
```

## Development workflow

```bash
# Lint + format
uvx prek

# Run tests
uv run pytest

# Launch viewer
uv run ndea view data/annotations_zv3.zarr

# Rebuild frontend after changes
cd frontend && pnpm build
```

## Code style

- **Python** -- enforced by [Ruff](https://docs.astral.sh/ruff/) (config in `pyproject.toml`)
- **Frontend** -- enforced by [Biome](https://biomejs.dev/) (config in `biome.jsonc`)
- **Git hooks** -- run via [prek](https://github.com/j178/prek) (`uvx prek`)

## Full guide

See the [contributing docs](https://czbiohub-sf.github.io/nd-embedding-atlas/contributing/) for detailed conventions, project structure, and CI details.
