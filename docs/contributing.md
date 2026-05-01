---
icon: lucide/git-pull-request
---

# Contributing

## Development setup

### Prerequisites

- **[Bun](https://bun.com)** — runtime + package manager. CI uses the version pinned in `package.json`'s `packageManager` field; locally any matching major works.
- **[Vite+](https://viteplus.dev/)** (`vp`) — frontend toolchain (build, lint, fmt, dev). Install once globally; `vp` drives every dev workflow.

### Clone and install

```bash
git clone https://github.com/czbiohub-sf/nd-embedding-atlas.git
cd nd-embedding-atlas
bun install
```

Backend and frontend share one `node_modules/`.

## Development workflow

```bash
# Full dev stack: backend on :5055 + Vite frontend on :5173 with HMR
vp run dev path/to/data.zarr
```

Wraps `src/cli/index.ts view` (backend) and `vp dev` (frontend), with cross-filter cache invalidation over Mosaic's WS.

Frontend-only when the backend already runs separately:

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

CI gates on `vp check` and the test suites (see `.github/workflows/ci.yml`).

## Fallow (optional code-health audit)

[Fallow](https://docs.fallow.tools/) is a static-analysis tool for TypeScript/JavaScript that flags dead code, duplication, complexity hotspots, and circular dependencies. Not a CI gate — run it on demand when working in an unfamiliar area or before opening a non-trivial PR.

```bash
bunx fallow audit --changed-since main   # scoped to your branch's diff
bunx fallow dead-code                    # unused files, exports, deps
bunx fallow dupes                        # repeated code blocks
bunx fallow health                       # cyclomatic / cognitive complexity
bunx fallow fix --dry-run                # preview auto-fixes (delete unused exports etc.)
```

Good moments to run it:

- **Before a non-trivial PR** — `fallow audit --changed-since main` returns a verdict on just the files you touched.
- **After merging a large feature** — catches dead code, orphaned exports, or new duplication that the focused review missed.
- **When picking up unfamiliar code** — `dead-code` and `health` give a quick picture of which files are load-bearing vs. detritus.

Skip it for trivial fixes; the signal-to-noise floor is high but real.

The static layer is MIT-licensed and free. The runtime-coverage feature (tracking what actually executed in production) is paid; it's behind `fallow coverage` and isn't used in this repo.

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

See [`AGENTS.md`](https://github.com/czbiohub-sf/nd-embedding-atlas/blob/main/AGENTS.md) for the canonical command catalogue, key abstractions, and gotchas.

## Releases

| Channel       | How it ships                                                      |
| ------------- | ----------------------------------------------------------------- |
| `stable`      | Manual: tag `vX.Y.Z` and push — `release.yml` builds + publishes  |
| `pre-release` | Manual: tag `vX.Y.Z-alpha.N` / `-beta.N` / `-rc.N` and push       |
| `canary`      | Automatic: every push to `main` rebuilds the rolling `canary` tag |

A `pre-release` cut opens an auto-generated PR that bumps `manifest.json`'s `pre-release` pointer. Merge to activate.

After editing `src/cli/commands/**`, regenerate the completion metadata:

```bash
vp run gen
```

Updates `.bunli/commands.gen.ts`, which feeds shell-completion script generation. CI fails on drift (`.github/scripts/check-bunli-gen.sh`).

## Editing this docs site

[zensical](https://zensical.org/) renders the pages under `docs/` using `zensical.toml`. Preview locally:

```bash
uvx --from zensical zensical serve
```

Live-reloads at `http://localhost:8000`. Build output goes to `site/` (gitignored). `uvx` is part of [uv](https://docs.astral.sh/uv/); zensical is fetched on demand and cached.
