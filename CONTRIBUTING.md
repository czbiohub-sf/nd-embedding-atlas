# Contributing

## Prerequisites

- **[Bun](https://bun.com)** — runtime + package manager. The version pinned in `package.json`'s `packageManager` field will be used by CI; locally any matching major works.
- **[Vite+](https://viteplus.dev/)** (`vp`) — unified toolchain for lint, fmt, test, and the dev server. Install once globally per their setup; `vp` drives every dev workflow in this repo. (The app _build_ runs on Bun — see `vp run build` below.)

## Setup

```bash
git clone https://github.com/czbiohub-sf/nd-embedding-atlas.git
cd nd-embedding-atlas
bun install
```

The root install resolves `apps/*` and `packages/*`. Documentation has its
own dependency graph and lockfile under `docs/`.

## Workspace layout

```text
apps/ndea/         CLI, server, frontend, and binary builder
packages/protocol/ Shared request and response schemas
packages/sdk/      Node authoring and host contracts
packages/zarr/     Bun-backed AnnData, MuData, and OME-Zarr I/O
docs/              Independent Waku documentation app
```

## Development workflow

```bash
# Full dev stack (backend on :5055 + Vite frontend on :5173, with HMR)
vp run dev path/to/data.zarr

# Shared root tooling, then every workspace in dependency order
vp check vite.config.ts bunli.config.ts scripts
vp run -r check

# Bun-native tests in every workspace
vp run -r test

# Production build — all-Bun (Bun.build frontend → single-file binary)
vp run build    # or `bun run build`

# Regenerate CLI completion metadata (after editing apps/ndea/src/cli/commands/**)
vp run gen

# Verify a built binary's install (paths, symlink, versions, manifest)
./dist/ndea doctor
```

`vp run dev` enables the node editor and persists each dataset's graph in
browser storage. Production builds compile the editor out by default, ignore
stored graphs, and open the fixed `--preset` layout (`annotate` by default).
Set `VITE_NDEA_NODE_EDITOR=true` at build time only when testing an
editor-enabled production bundle.

See [`AGENTS.md`](./AGENTS.md) for the full command catalogue, project layout,
key abstractions, and gotchas.

## Code style

Enforced by `vp check`:

- **TypeScript 6 strict** — no implicit any, `import type` for type-only imports
- **Oxlint** + **Oxfmt** — config lives in `vite.config.ts`
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
vp run docs:dev
```

## Pull requests

`ci.yml` checks root tooling, workspace types, workspace boundaries, generated
CLI metadata, Bun tests, and native binaries on push and PR. `docs.yml` builds
the isolated docs app. `zizmor.yml` audits workflow security.

For releases, see [`AGENTS.md`](./AGENTS.md#commands). Release tags trigger
`release.yml`.
