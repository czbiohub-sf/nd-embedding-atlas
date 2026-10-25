# Contributing

## Prerequisites

- **[Vite+](https://viteplus.dev/)** (`vp`): the sole developer command interface for dependencies, tasks, checks, builds, and development servers.
- **[Bun](https://bun.com)**: runtime, package manager, test runner, and compiler used underneath Vite+. CI uses the version pinned in `package.json`.

Use `vp` for every command you run directly. `vp run` dispatches package scripts, which may use Bun for tests, scripts, and single-binary compilation.

## Setup

```bash
git clone https://github.com/czbiohub-sf/nd-embedding-atlas.git
cd nd-embedding-atlas
vp install
cd docs && vp install && cd ..
```

The root install resolves `apps/*` and `packages/*`. Documentation has its
own dependency graph and lockfile under `docs/`.

## Dependency management

```bash
# Audit root tooling and every workspace
vp outdated
vp outdated -r
# Update workspace resolutions within declared ranges
vp update -r

# Add or remove a dependency in the selected workspace
vp add --filter @ndea/app <package>
vp remove --filter @ndea/app <package>

# Update the independent docs application
cd docs
vp outdated
vp update
```

Shared `catalog` constraints live in the root `package.json`; update each
constraint there once, then run `vp install`. Update root-only tooling packages
reported by `vp outdated` explicitly with `vp update <package...>`; a blanket
root update would replace unrelated `catalog:` references with package-local
ranges. Review `overrides` separately because they are deliberately pinned.

## Workspace layout

```text
apps/ndea/            CLI, server, frontend, and binary builder
packages/components/  Built-in component definitions and their bodies
packages/ochre/       Color, colormap, and TypeGPU helpers
packages/protocol/    Shared request and response schemas
packages/sdk/         Component authoring and host contracts
packages/ui/          Shared UI controls
packages/zarr/        Bun-backed AnnData, MuData, and OME-Zarr I/O
docs/                 Independent Waku documentation app
```

## Development workflow

```bash
# Dev server: one Bun process (frontend with HMR + API) at https://ndea.localhost
# (a linked worktree: https://<last branch segment>.ndea.localhost), opening
# ../ome-atlas-test-data/infectomics/infectomics.yaml. Run from the repo root;
# Ctrl+C stops it. The first run starts the portless proxy (HTTPS on :443, asks
# for sudo and trusts its CA once); `PORTLESS=0 vp run dev` skips it and serves
# http://localhost:5055.
vp run dev
# Synthetic in-memory dataset instead
vp run dev --fixture

# Check + test root tooling and every workspace (cached; what CI runs)
vp run verify

# Build the frontend and single-file binary
vp run build

# Verify a built binary's install (paths, symlink, versions, manifest)
./dist/ndea self doctor
```

`vp run dev` enables dashboard layout editing (split, swap, remove, fill a
slot). Every build opens the server-owned workspace document, which starts
from the `--preset` document (`exploration` by default).

See [`AGENTS.md`](./AGENTS.md) for the full command catalogue, project layout,
key abstractions, and gotchas.

## Code style

Enforced by `vp check`:

- **TypeScript 7 strict**: no implicit any, `import type` for type-only imports
- **Oxlint** + **Oxfmt**: config lives in `vite.config.ts`
- 4-space indent, double quotes, trailing commas, semicolons
- `@/` path alias → `apps/ndea/src/frontend/`
- Kebab-case ordinary modules, PascalCase React component modules, and `useX`
  hook modules. `unicorn/filename-case` enforces these shapes; review enforces
  each file's semantic role.
- Shared packages import only exported `@ndea/*` entrypoints.

## Documentation

User-facing docs live under `docs/` as an independent
[Waku](https://waku.gg/) app:

```bash
# Production build from the repository root
vp run docs:build

# Serve the production build
vp run docs:serve
# Open http://localhost:8080/nd-embedding-atlas/

# Local development with hot reload
vp run docs
```

## Pull requests

`ci.yml` runs `vp run verify` (root tooling and workspace checks and Bun tests)
and builds native binaries on push and PR. `docs.yml` builds the isolated docs
app. `zizmor.yml` audits workflow security.

Before tagging a release, bump `apps/ndea/package.json` and run
`vp run release:version`. Release tags trigger `release.yml`.
