# nd-embedding-atlas

Interactive browser-based Node Workspace linking AI embeddings to source 5D
(TCZYX) image data. APIs remain in flux.

## Runtime and tooling

- Use Vite+ (`vp`) as the only developer-facing command interface: dependency
  management, package scripts, workspace tasks, checks, tests, builds, and the
  frontend dev server all start with `vp`.
- Bun remains the runtime, package manager, test runner, script host, and binary
  compiler underneath Vite+. Package scripts and low-level tooling may invoke
  Bun; developers should not invoke it directly. Do not use Node.js, npm, pnpm,
  Yarn, or Python.
- Import Vite and test APIs from `vite-plus` and `vite-plus/test`. Do not install
  Vite, Vitest, Oxlint, Oxfmt, or tsdown separately.
- Run package scripts with `vp run <script>`. Bare commands such as `vp build`
  invoke Vite+ built-ins, not same-named package scripts.
- TypeScript 6 runs in strict mode.

## Workspace layout

```text
apps/ndea/          CLI, server, frontend, and single-binary build
packages/protocol/  Shared request and response Zod schemas
packages/sdk/       Node authoring and host contracts
packages/zarr/      Bun-backed AnnData, MuData, and OME-Zarr I/O
docs/               Independent Waku app with its own lockfile
scripts/             Workspace tooling
```

Workspace dependencies flow in one direction:

```text
apps/ndea  ──→  @ndea/sdk, @ndea/protocol, @ndea/zarr
@ndea/sdk  ──→  @ndea/protocol
```

Shared packages must not import app code. Import only public `@ndea/*`
entrypoints across workspaces.

## Architecture

### Data layer

- `@ndea/zarr` opens AnnData, MuData, and OME-Zarr stores through zarrita and
  `BunFileStore`.
- `AnnData.from(parsed)` exposes `.obs` and `.var` DataFrames.
- `toDuckDB(conn)` registers `obs_base` and `var_base` through DuckDB appenders.
- `BunFileStore.getRange` supports `{ offset, length }` and `{ suffixLength }`.
  Zarr v3 sharding needs suffix reads for shard indexes.

### Server

- `createApp()` in `apps/ndea/src/server/app.ts` creates the Bun HTTP and
  WebSocket server.
- `/mosaic` carries the preferred long-lived Mosaic WebSocket protocol.
  `/data/query` remains the REST test and curl fallback.
- Other WebSocket paths use the framed `{ _id, _type }` ndea protocol.
- REST routes cover embeddings, observations, scatter data, variables,
  categorization, annotations, exports, crops, and plugin bootstrap.
- `EmbeddingStore` owns one DuckDB connection. Base tables, the `dataset` view,
  temporary selections, and Mosaic preaggregations share that connection.

### SDK and plugins

- `PluginFactory` registers complete `NodeDefinition` objects through
  `@ndea/sdk`.
- `NodeModule` creates per-instance runtimes and framework-neutral mounted
  bodies.
- `NodeHost` exposes declared, capability-gated services.
- Startup validates plugin manifests, serves allowlisted assets, imports only
  approved client URLs, and freezes the session catalog before restoration.
- `SDK_VERSION` versions the author contract independently from app, manifest,
  node, config, asset, and Workspace document versions.

### Frontend

- React 19 renders the Node Workspace.
- TypeGPU drives the WebGPU scatter plot, including GPU lasso and marquee
  selection.
- Mosaic and server-side DuckDB drive cross-filtered scatter, table, and chart
  views.
- `DatasetSessionProvider` owns metadata, trajectories, query infrastructure,
  and the session-local runtime manager.
- Workspace owns graph transactions, persistence, Canvas, Stage, and Body
  placement. Node code reaches cross-view coordination through `NodeHost`.

## Commands

```bash
# Install
vp install

# Audit root tooling and every workspace
vp outdated
vp outdated -r
# Update workspace resolutions within declared ranges
vp update -r

# Full development stack: backend :5055, frontend :5173
vp run dev /path/to/data.zarr

# Run either half
vp run backend /path/to/data.zarr
vp dev apps/ndea

# Root and workspace checks
vp check vite.config.ts bunli.config.ts scripts
vp run -r check
vp run -r test

# Production binary: dist/ndea
vp run build

# CLI completion metadata
vp run gen

# Documentation
vp run docs:build
vp run docs:dev
vp run docs:serve
```

Shared `catalog` constraints live in the root `package.json`; update each
constraint there once, then run `vp install`. Update root-only tooling packages
reported by `vp outdated` explicitly with `vp update <package...>` so Bun does
not replace unrelated `catalog:` references with package-local ranges. Use
`vp add --filter <workspace> <package>` and
`vp remove --filter <workspace> <package>` for targeted workspace changes.

`vp run build` delegates to the app's Bun build. Do not use bare `vp build`;
that invokes Rolldown instead of the single-binary pipeline. Direct
compiler invocation also fails on embedded font assets; use the project task.

The node editor runs in development. Production builds compile it out and load
the selected preset.

## Code rules

- Use `import type` for type-only imports.
- Use double quotes, semicolons, trailing commas, and Oxfmt defaults.
- Use `@/` for `apps/ndea/src/frontend/` imports.
- Name ordinary modules in kebab case, React component modules in PascalCase,
  and hooks with `useX`.
- Route frontend schema mutations through `/api/categorize` and
  `/api/var-column`; Mosaic SQL blocks client-side `ALTER` and `UPDATE`.
- Regenerate `.bunli/commands.gen.ts` with `vp run gen` after changing CLI
  command definitions.

## Load-bearing constraints

- **Mosaic cache:** `QueryManager` keys results by raw SQL. Predicates that
  reference mutable temporary tables need a revision-specific SQL suffix.
- **Mosaic SQL:** The allowlist must permit Mosaic's `CREATE SCHEMA`,
  `CREATE TABLE`, `DROP TABLE IF EXISTS`, and `DROP SCHEMA` statements.
- **DuckDB views:** `ALTER TABLE obs_base ADD COLUMN` invalidates the `dataset`
  view schema. Rebuild it through `EmbeddingStore._rebuildView()`.
- **Workers:** `new URL("./worker.ts", import.meta.url)` must work in development
  and compiled binaries. Bun embeds workers automatically.
- **Static files:** Development reads `dist/frontend/`; compiled binaries read
  `$bunfs/`. Both paths use `Bun.file()`.
- **Native addon:** `duckdb.node` embeds in the binary and prevents
  cross-compilation. Build on each target platform.
- **Updates:** Standalone installs live under `~/.ndea/versions/<tag>/ndea`;
  update atomically repoints `~/.local/bin/ndea` and keeps only the active
  version by default. Mise-managed updates must go through mise and must never
  mutate the standalone tree.
