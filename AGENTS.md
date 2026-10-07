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
packages/graph/     Framework-neutral graph evaluation engine
packages/nodes/     Built-in node definitions and React bodies
packages/ochre/     Color, colormap, and TypeGPU helpers
packages/ui/        Shared shadcn/Base UI controls
packages/protocol/  Shared request and response Zod schemas
packages/sdk/       Node authoring and host contracts
packages/zarr/      Bun-backed AnnData, MuData, and OME-Zarr I/O
docs/               Independent Waku app with its own lockfile
scripts/             Workspace tooling
```

Workspace dependencies flow in one direction:

```text
apps/ndea    ──→  every @ndea/* package
@ndea/nodes  ──→  @ndea/sdk, @ndea/protocol, @ndea/ochre, @ndea/ui
@ndea/graph  ──→  @ndea/sdk
@ndea/sdk    ──→  @ndea/protocol
@ndea/ui     ──→  @ndea/ochre
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
  categorization, annotations, exports, crops, filtering, the workspace
  document, and plugin bootstrap.
- `WorkspaceDocumentStore` (`server/workspace.ts`) owns the session's one
  revisioned workspace document and its file. A missing file is written from
  the preset (`server/presets.ts`): a built-in JSON document under
  `apps/ndea/src/presets/` or a `.json` path. `PATCH /api/workspace` applies
  RFC 6902 ops against a base revision; `workspace/watch` pushes accepted
  revisions.
- `WorkspaceEvaluator` (`server/graph.ts`) evaluates that document with the
  browser's node definitions and the shared cook table
  (`frontend/core/graph/native-graph.ts`); `GET /api/workspace/nodes/:id`
  serves one node's output. Every view and live Cache cook ANDs its own filter
  scope (`host.scopeFilter()`), so both sides compose crossfilters identically.
  Cooks must stay browser-free. SQL built from document values runs through
  `server/observations.ts`, which prepares every statement
  (`DatasetQuerySession.querySingleJson` / `executeSingle`).
- `ObservationSets` (`server/observation-sets.ts`) stores lassos as
  content-addressed sets keyed by dataset and obs name: `POST /api/sets`
  persists `~/.ndea/sets/<id>.json` and loads rows into the `ndea_obs_sets`
  temp table that `{ op: "inSet" }` clauses query. A pinned Cache stores its
  rows as one such set in its node config. `PATCH /api/workspace` rejects
  references to unknown sets anywhere in the document.
- `EmbeddingStore` owns one DuckDB connection. Base tables, the `dataset` view,
  temporary selections, and Mosaic preaggregations share that connection.

### SDK and plugins

- `PluginFactory` registers complete `NodeDefinition` objects through
  `@ndea/sdk`.
- `NodeModule` creates per-instance runtimes and framework-neutral mounted
  bodies.
- `NodeHost` exposes declared, capability-gated services. A new capability is
  one `NodeCapability` union member in `@ndea/sdk` plus one `nodeCapabilities`
  entry in `frontend/core/node/capabilities.ts`.
- Graph ports carry one kind, `pred` (a SQL predicate). Row selections travel
  as observation sets referenced by `{ op: "inSet" }` clauses.
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
- Workspace owns Canvas, Stage, and Body placement in the browser. Every
  document write goes through `Workspace.commit`, which reconciles the graph
  runtime to the next document before publishing it; local edits, coordination
  writes, and remote revisions (`Workspace.applyDocument`) share that path.
  `WorkspaceSync` diffs the document store against the server's acknowledged
  revision and PATCHes the difference. Node code reaches cross-view
  coordination through `NodeHost`.
- Coordination is document data, not wires. `state[type][scope]` holds shared
  values and `bindings[nodeId][type] = { $bindState: "/<type>/<scope>" }`
  joins a node to a scope; `frontend/core/coordination/types.ts` registers each
  type's Zod schema (focus, filter, colorBy, viewSync, ordering). A `filter`
  scope is a crossfilter `source → facet → FilterClause`: each member sees every
  other source's clauses, never its own, and agents write under their own
  source key. Publishers emit typed clauses, never SQL.
- The xyflow canvas is a projection of the document and `Workspace.session`;
  only measured node sizes are canvas-local. Each scope with a member on the
  current level draws as a derived hub, and each binding as one link
  (`workspace/canvas/scope-links.ts`): deleting a link clears that binding and
  dragging a hub onto a node assigns it. Keep the projection total: every
  document binding must render as a link, even one the node cannot use.
- json-render renders the Stage from the document's `stage`, a flat spec of
  `Split`, `View`, and `Slot` elements (`workspace/stage/stage-spec.ts` holds
  the schema, structural rules, operations, and catalog). A node is staged
  exactly when a `View` shows it. Components get element ids through a
  render-only `elementId` prop, and props resolve json-render expressions
  against coordination `state`. Views adopt the node's stable body dock.

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

The node editor runs in development. Production builds compile it out and open
the document's Stage.

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
- **Workspace authority:** The server document is the only persisted workspace.
  Never write workspace state to `localStorage`. Session state (selection,
  claim, subnet path, canvas disposition) lives in `Workspace.session`; add new
  editor-only fields to `WorkspaceSession` in `workspace/types.ts`. The file
  format accepts only its exact version; there are no migrations.
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
- **Windows:** Releases ship `ndea-windows-x64.exe`, installed by
  `scripts/install.ps1` to `%LOCALAPPDATA%\ndea\bin`. There is no versions
  tree and no symlink, so `ndea update` exits early on `win32`; re-running the
  installer is the upgrade path. DuckDB ships the shared library as
  `duckdb.dll`, not `libduckdb.dll`: `libduckdb-cache.ts` owns that name for
  both the preloader and `ndea doctor`.
