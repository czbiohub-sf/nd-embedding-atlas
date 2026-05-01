# Contributing

## Prerequisites

- **[Bun](https://bun.com)** — runtime + package manager. The version pinned in `package.json`'s `packageManager` field will be used by CI; locally any matching major works.
- **[Vite+](https://viteplus.dev/)** (`vp`) — unified frontend toolchain (build, lint, fmt, dev). Install once globally per their setup; `vp` then drives every dev workflow in this repo.

## Setup

```bash
git clone https://github.com/czbiohub-sf/nd-embedding-atlas.git
cd nd-embedding-atlas
bun install
```

## Development workflow

```bash
# Full dev stack (backend on :5055 + Vite frontend on :5173, with HMR)
vp run dev path/to/data.zarr

# Quality gates (typecheck + Oxlint + Oxfmt + bunli gen drift)
vp check

# Tests (Bun-native .test.ts suites)
bun test

# Production build (frontend bundle + single-file binary)
bun run build

# Regenerate CLI completion metadata (after editing src/cli/commands/**)
vp run gen
```

See [`AGENTS.md`](./AGENTS.md) for the full command catalogue, project layout, key abstractions, and gotchas. That file is the source of truth.

## Code style

Enforced by `vp check`:

- **TypeScript 6 strict** — no implicit any, `import type` for type-only imports
- **Oxlint** + **Oxfmt** — config lives in `vite.config.ts`
- 4-space indent, double quotes, trailing commas, semicolons
- `@/` path alias → `src/frontend/`

## Documentation

User-facing docs live under `docs/` and are rendered by [zensical](https://zensical.org/) via the config at `zensical.toml`. To preview locally without installing Python tooling permanently:

```bash
uvx --from zensical zensical serve     # http://localhost:8000, live reload
uvx --from zensical zensical build     # static output → site/ (gitignored)
```

`uvx` is part of [uv](https://docs.astral.sh/uv/) — install once via `brew install uv` or `curl -LsSf https://astral.sh/uv/install.sh | sh`. Zensical itself is fetched on demand and cached.

## Pull requests

`ci.yml` runs typecheck + lint + fmt + gen drift + bun test on push and PR. `zizmor.yml` audits workflow security. Both must pass before merge.

For releases, see [`AGENTS.md`](./AGENTS.md#commands) — release tags trigger `release.yml`, push to main triggers `canary.yml` (rolling pre-release).
