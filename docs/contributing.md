---
icon: lucide/git-pull-request
---

# Contributing

## Development setup

### Prerequisites

- **[Bun](https://bun.com)** — runtime + package manager. The version pinned in `package.json`'s `packageManager` field is what CI uses; locally any matching major works.
- **[Vite+](https://viteplus.dev/)** (`vp`) — unified frontend toolchain (build, lint, fmt, dev). Install once globally; `vp` then drives every dev workflow in this repo.

### Clone and install

```bash
git clone https://github.com/czbiohub-sf/nd-embedding-atlas.git
cd nd-embedding-atlas
bun install
```

`bun install` resolves both backend and frontend dependencies into a single `node_modules/`.

## Development workflow

```bash
# Full dev stack (backend on :5055 + Vite frontend on :5173, with HMR)
vp run dev path/to/data.zarr
```

The wrapper boots `src/cli/index.ts view` for the backend and `vp dev` for the frontend, with cross-filter cache invalidation hooked up via Mosaic's WS.

For frontend-only iteration when the backend is already running separately:

```bash
vp dev
```

## Quality gates

```bash
vp check        # typecheck + Oxlint + Oxfmt + bunli gen drift
bun test        # Bun-native .test.ts suites (server, cli, zarr)
vp test         # vitest (frontend unit tests)
vp build        # frontend bundle smoke
```

`vp check` and the test suites are what CI gates on (see `.github/workflows/ci.yml`).

## Code style

Enforced by `vp check`:

- **TypeScript 6 strict** — no implicit any, `import type` for type-only imports
- **[Oxlint](https://oxc.rs/docs/guide/usage/linter.html)** + **[Oxfmt](https://oxc.rs/docs/guide/usage/formatter.html)** — config in `vite.config.ts` `lint` / `fmt` blocks
- 4-space indent, double quotes, trailing commas, semicolons
- `@/` path alias → `src/frontend/`

## Project structure

```text
src/
  index.ts            # Public API re-exports
  cli/                # Bun-compiled CLI (bunli framework)
  protocol/           # Shared zod schemas (client + server contract)
  zarr/               # Vendored zarr I/O — reads AnnData / MuData / OME-Zarr
  server/             # Bun.serve HTTP + WebSocket server
    routes/           # Per-endpoint handlers
  frontend/           # React + Vite + Mosaic dashboard
    components/       # Scatter, table, charts, toolbar, viewer panels
    dashboard/        # DashboardContext / Provider / Shell
    scatter-gpu/      # TypeGPU/WebGPU scatter renderer
    stores/           # TanStack Store singletons (selection, view, filter)
    ochre/            # Vendored colormap library
```

See [`AGENTS.md`](https://github.com/czbiohub-sf/nd-embedding-atlas/blob/main/AGENTS.md) in the repo root for the canonical command catalogue, key abstractions, and gotchas.

## Releases

| Channel       | How it ships                                                      |
| ------------- | ----------------------------------------------------------------- |
| `stable`      | Manual: tag `vX.Y.Z` and push — `release.yml` builds + publishes  |
| `pre-release` | Manual: tag `vX.Y.Z-alpha.N` / `-beta.N` / `-rc.N` and push       |
| `canary`      | Automatic: every push to `main` rebuilds the rolling `canary` tag |

`pre-release` cuts open an automated PR that bumps the `pre-release` channel pointer in `manifest.json` — review and merge to make `ndea update --channel pre-release` resolve to the new tag.

Code generation: after editing `src/cli/commands/**`, run:

```bash
vp run gen
```

This regenerates `.bunli/commands.gen.ts`, which feeds shell-completion script generation. CI fails if the generated file drifts from source (`.github/scripts/check-bunli-gen.sh`).
