# nd-embedding-atlas

Interactive browser-based dashboard linking AI embeddings to source 5D (TCZYX)
image data. Early-stage — APIs are in flux.

## Stack

- **Bun** runtime + package manager (no Node.js, no Python)
- **Vite+** (`vp`) unified toolchain — lint, fmt, test, build (see block at EOF)
- **TypeScript 6** strict mode
- **zarr (src/zarr/)** — vendored I/O, reads AnnData / MuData / OME-Zarr via
  zarrita on top of `BunFileStore`
- **duckdb-node** native — analytical queries, Arrow IPC, Mosaic query protocol
- **@uwdata/flechette** — Arrow columnar (pure JS, 14KB)
- **@uwdata/mosaic-\*** — cross-filter analytics
- **Bun.serve** — HTTP + WebSocket server (replaces FastAPI)
- **React 19 + Vite 8 + TypeGPU v0.11** custom WebGPU scatter frontend
- **TanStack** Query, Store, Pacer, Table, Virtual, Hotkeys

## Project layout

```text
src/
  index.ts            # Public API re-exports
  cli/                # CLI entry point
    commands/         # view, update, rollback, gc, doctor, completions
  protocol/           # Shared request/response zod schemas (client + server)
  zarr/               # Custom zarr I/O (AnnData, MuData, OME-Zarr)
    bun-store.ts      # BunFileStore — AsyncReadable backed by Bun.file
    anndata-class.ts  # AnnData public API (obs + var DataFrames + toDuckDB)
    data-frame.ts     # DataFrame surface over AnnDataFrame
    to-duckdb.ts      # DuckDB Appender-based ingest (obs_base, var_base)
    zarr-boundary.ts  # One-file home for zarrita type casts
    {anndata,mudata,ome-zarr,open,types}.ts  # Convention parsers + types
  server/             # Bun.serve HTTP + WS server
    app.ts            # createApp() factory — routes + WS upgrade
    ws.ts             # Framed {_id,_type} ndea WS protocol
    mosaic-ws.ts      # Mosaic socketConnector adapter at /mosaic
    mosaic.ts         # SQL allow-list + handleMosaicQuery (REST fallback)
    store.ts          # EmbeddingStore (DuckDB connection, views, appender)
    state.ts          # ViewerState — AnnData handles, spatial, plate mounts
    routes/           # Per-endpoint handlers (obs, var, embeddings, …)
  frontend/           # React + Vite + Mosaic dashboard (same tree now)
    components/       # scatter, table, charts, toolbar, viewer, layout
    dashboard/        # DashboardContext / Provider / Shell
    hooks/            # useDashboard, useColumnTypes, useMosaicClient, …
    stores/           # ActiveFilterStore, SelectionSyncStore, ViewSyncStore
    scatter-gpu/      # TypeGPU/WebGPU scatter renderer + hooks
    lib/              # mosaic-helpers, chart-spec, category-column, ws-client
    ochre/            # Custom ochre colormap library
```

## Module dependency graph

```text
cli          ──→  zarr.open() / AnnData, server/app
server/app   ──→  server/routes/*, zarr (AnnData), duckdb-node
server/*     ──→  duckdb + Mosaic query protocol (REST + WS /mosaic)
zarr         ──→  zarrita, flechette, BunFileStore (Bun.file)
frontend     ──→  @uwdata/mosaic-core socketConnector (ws /mosaic),
                  REST fallback /data/query
```

## Key abstractions

### zarr (`src/zarr/`)

- `open(path)` — auto-detect convention (AnnData, MuData, OME-Zarr); returns
  a discriminated `ParsedStore`.
- `AnnData.from(parsed)` — class with `.obs` and `.var` as `DataFrame`s.
- `toDuckDB(conn)` — registers `obs_base` + `var_base` via the shared
  Appender path (no CSV round-trip).
- `BunFileStore.getRange` handles both `{offset,length}` and `{suffixLength}`
  (zarrita v3 sharding codec reads the shard index from the file tail).
- Convention parsers detect store format from root `.zattrs` / `zarr.json`.

### Server (`src/server/`)

- `createApp()` — Bun.serve factory, wires routes + DuckDB + static serving.
- Mosaic query protocol lives on two transports:
  - **WebSocket** at `/mosaic` (socketConnector — preferred, shared long-lived
    connection).
  - **REST** at `/data/query` (kept as test/curl fallback).
- WebSocket upgrade routes by pathname: `/mosaic` → Mosaic framing,
  any other path → framed `{_id,_type}` ndea protocol in `ws.ts`.
- REST endpoints: `/api/embeddings/*`, `/api/obs/*`, `/api/scatter-*`,
  `/api/var/*`, `/api/categorize`, `/api/obssets/*`, `/api/export`, `/api/crop/*`.
- `EmbeddingStore` — single DuckDB connection; `obs_base` + `var_base` tables
  - `dataset` VIEW joining registered obsm tables. Temp tables
    (`__scatter_selection`, `mosaic.preagg_*`) live on the same connection.

### Frontend (`src/frontend/`)

- WebGPU scatter via TypeGPU v0.11 — instanced quads, GPU-side lasso/marquee
  with compute readback.
- Mosaic cross-filter: scatter + table + charts all driven by server DuckDB.
- TanStack Store singletons bridge React ↔ Mosaic:
  - `ActiveFilterStore` — current SQL predicate (lasso or obsset).
  - `SelectionSyncStore` — cross-panel selection mirror.
  - `ViewSyncStore` — pan/zoom lock across panels.
- `Coordinator` created once per session with `logger: PROD ? null : console`
  and a `socketConnector({uri: ws(s)://host/mosaic})`.

## Commands

```zsh
# Dev stack (backend + frontend concurrently)
vp run dev /path/to/data.zarr        # primary — backend :5055 + Vite :5173 with HMR

# Or separately when iterating on one half
bun run src/cli/index.ts view /path/to/data.zarr   # backend on :5055
vp dev                                             # frontend on :5173

# Dependencies
bun install                       # backend + frontend share one node_modules

# Build
vp build                          # frontend bundle → dist/frontend/
bun run build                     # frontend + single-file binary → dist/ndea
                                  #   (delegates to scripts/build.ts; the embed
                                  #   manifest pattern is required — direct
                                  #   `bun build --compile` crashes on .woff2)

# Quality gates
vp check                          # typecheck + Oxlint + Oxfmt (all ~260 files)
vp test                           # vitest
bun test                          # Bun-native .test.ts suites

# Code generation
vp run gen                        # regenerate .bunli/commands.gen.ts (CLI metadata
                                  #   for shell completions; CI verifies no drift)
```

## Code style

Oxlint + Oxfmt via `vp check` (config in `vite.config.ts`).

- **TypeScript strict** — no implicit any
- **`import type`** for type-only imports (`verbatimModuleSyntax`)
- **4-space indent** (Oxfmt default)
- **Double quotes**, trailing commas, semicolons
- **`@/` path alias** → `src/frontend/`

## Gotchas

- **Mosaic query cache**: `QueryManager` caches results by raw SQL text. Any
  predicate that refers to a temp table whose contents change (e.g.
  `__scatter_selection`) needs a unique suffix per revision, else stale hits.
- **Mosaic preagg tables**: Server emits `CREATE TABLE mosaic.preagg_*` — SQL
  allow-list in `mosaic.ts` must permit `CREATE SCHEMA / CREATE TABLE /
DROP TABLE IF EXISTS / DROP SCHEMA`; nothing else.
- **VIEW schema invalidation**: `ALTER TABLE obs_base ADD COLUMN` invalidates
  the `dataset` VIEW schema. `EmbeddingStore._rebuildView()` handles this on
  embedding / var-column / categorize registration.
- **Frontend schema mutations**: go through `/api/categorize` and
  `/api/var-column`, not `/data/query`. The mosaic allow-list blocks
  client-side `ALTER` / `UPDATE`.
- **Worker URL in compiled binary**: `new URL("./column-worker.ts",
import.meta.url)` must resolve in both dev and `bun build --compile`. Bun
  embeds Workers automatically.
- **Frontend static serving**: dev reads from `dist/frontend/` on disk,
  compiled binary reads from `$bunfs/` embedded filesystem — same
  `Bun.file()` API, different backing.
- **Native `.node` addon**: `duckdb.node` (~53 MB) embeds into the compiled
  binary but prevents cross-compilation. Build per-platform.
- **Zarr v3 sharding**: shard index is read via `getRange(path,
{suffixLength})`. `BunFileStore.getRange` must support the suffix form or
  the crc32c codec throws "Failed to decode chunk".

## Key decisions

- **Bun single binary** — zero-dependency distribution via `bun build --compile`.
- **Custom zarr I/O** — built on `zarrita` + `flechette`; no anndata / dask runtime needed.
- **Native DuckDB** (not WASM) — full speed, no 4 GB memory ceiling.
- **Bun.serve** (no framework) — raw fetch handler, simple route dispatch.
- **Custom React + Vite + TypeGPU frontend** — full control over WebGPU scatter.
- **Server-side DuckDB** — Mosaic cross-filter, avoids browser memory limits.
- **socketConnector over REST** — Mosaic queries share one WS connection;
  REST `/data/query` kept only for tests and curl.
- **Versions-dir + symlink install layout** — `~/.ndea/versions/<tag>/ndea` holds
  every binary that was ever installed; `$NDEA_BIN_DIR/ndea` is a symlink into it.
  `ndea update` writes the new version, then atomically swaps the symlink via
  `rename(2)`; running sessions keep their open handle to the old binary.
  `ndea rollback` repoints to the previous entry. `ndea gc` prunes old ones.
  Mirrors rustup / mise / Claude Code; replaced an earlier
  staged-pending + apply-on-launch dance.

## Resources

- [Mosaic](https://github.com/uwdata/mosaic) — cross-filtered viz framework
- [TypeGPU](https://typegpu.com) — type-safe WebGPU library
- [idetik](https://github.com/chanzuckerberg/idetik) — spatial layer rendering
- [Bun single-file executable](https://bun.com/docs/bundler/executables)

<!--VITE PLUS START-->

# Using Vite+, the Unified Toolchain for the Web

This project is using Vite+, a unified toolchain built on top of Vite, Rolldown, Vitest, tsdown, Oxlint, Oxfmt, and Vite Task. Vite+ wraps runtime management, package management, and frontend tooling in a single global CLI called `vp`. Vite+ is distinct from Vite, but it invokes Vite through `vp dev` and `vp build`.

## Vite+ Workflow

`vp` is a global binary that handles the full development lifecycle. Run `vp help` to print a list of commands and `vp <command> --help` for information about a specific command.

### Start

- create - Create a new project from a template
- migrate - Migrate an existing project to Vite+
- config - Configure hooks and agent integration
- staged - Run linters on staged files
- install (`i`) - Install dependencies
- env - Manage Node.js versions

### Develop

- dev - Run the development server
- check - Run format, lint, and TypeScript type checks
- lint - Lint code
- fmt - Format code
- test - Run tests

### Execute

- run - Run monorepo tasks
- exec - Execute a command from local `node_modules/.bin`
- dlx - Execute a package binary without installing it as a dependency
- cache - Manage the task cache

### Build

- build - Build for production
- pack - Build libraries
- preview - Preview production build

### Manage Dependencies

Vite+ automatically detects and wraps the underlying package manager such as pnpm, npm, or Yarn through the `packageManager` field in `package.json` or package manager-specific lockfiles.

- add - Add packages to dependencies
- remove (`rm`, `un`, `uninstall`) - Remove packages from dependencies
- update (`up`) - Update packages to latest versions
- dedupe - Deduplicate dependencies
- outdated - Check for outdated packages
- list (`ls`) - List installed packages
- why (`explain`) - Show why a package is installed
- info (`view`, `show`) - View package information from the registry
- link (`ln`) / unlink - Manage local package links
- pm - Forward a command to the package manager

### Maintain

- upgrade - Update `vp` itself to the latest version

These commands map to their corresponding tools. For example, `vp dev --port 3000` runs Vite's dev server and works the same as Vite. `vp test` runs JavaScript tests through the bundled Vitest. The version of all tools can be checked using `vp --version`. This is useful when researching documentation, features, and bugs.

## Common Pitfalls

- **Using the package manager directly:** Do not use pnpm, npm, or Yarn directly. Vite+ can handle all package manager operations.
- **Always use Vite commands to run tools:** Don't attempt to run `vp vitest` or `vp oxlint`. They do not exist. Use `vp test` and `vp lint` instead.
- **Running scripts:** Vite+ built-in commands (`vp dev`, `vp build`, `vp test`, etc.) always run the Vite+ built-in tool, not any `package.json` script of the same name. To run a custom script that shares a name with a built-in command, use `vp run <script>`. For example, if you have a custom `dev` script that runs multiple services concurrently, run it with `vp run dev`, not `vp dev` (which always starts Vite's dev server).
- **Do not install Vitest, Oxlint, Oxfmt, or tsdown directly:** Vite+ wraps these tools. They must not be installed directly. You cannot upgrade these tools by installing their latest versions. Always use Vite+ commands.
- **Use Vite+ wrappers for one-off binaries:** Use `vp dlx` instead of package-manager-specific `dlx`/`npx` commands.
- **Import JavaScript modules from `vite-plus`:** Instead of importing from `vite` or `vitest`, all modules should be imported from the project's `vite-plus` dependency. For example, `import { defineConfig } from 'vite-plus';` or `import { expect, test, vi } from 'vite-plus/test';`. You must not install `vitest` to import test utilities.
- **Type-Aware Linting:** There is no need to install `oxlint-tsgolint`, `vp lint --type-aware` works out of the box.

## CI Integration

For GitHub Actions, consider using [`voidzero-dev/setup-vp`](https://github.com/voidzero-dev/setup-vp) to replace separate `actions/setup-node`, package-manager setup, cache, and install steps with a single action.

```yaml
- uses: voidzero-dev/setup-vp@v1
  with:
    cache: true
- run: vp check
- run: vp test
```

## Review Checklist for Agents

- [ ] Run `vp install` after pulling remote changes and before getting started.
- [ ] Run `vp check` and `vp test` to validate changes.
<!--VITE PLUS END-->
