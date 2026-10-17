# nd-embedding-atlas

Interactive browser-based dashboard linking AI embeddings to source 5D (TCZYX)
image data. json-render composes the whole UI from one workspace document.
APIs remain in flux.

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
- TypeScript 7 runs in strict mode.

## Workspace layout

```text
apps/ndea/            CLI, server, frontend, and single-binary build
packages/components/  Built-in component definitions and their bodies
packages/ochre/       Color, colormap, and TypeGPU helpers
packages/ui/          Shared shadcn/Base UI controls
packages/protocol/    Shared request and response Zod schemas
packages/sdk/         Component authoring and host contracts
packages/zarr/        Bun-backed AnnData, MuData, and OME-Zarr I/O
docs/                 Independent Waku app with its own lockfile
scripts/              Workspace tooling
```

Workspace dependencies flow in one direction:

```text
apps/ndea         ──→  every @ndea/* package
@ndea/components  ──→  @ndea/sdk, @ndea/protocol, @ndea/ochre, @ndea/ui
@ndea/sdk         ──→  @ndea/protocol
@ndea/ui          ──→  @ndea/ochre
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
- `/data/query` serves Mosaic's `restConnector` (`POST { type, sql }`;
  `arrow` returns Arrow IPC bytes, `exec` returns `{}`).
- `/ws` carries the framed `{ _id, _type }` ndea protocol; its one method is
  `workspace/watch`.
- REST routes cover health, config, embeddings, observations, scatter data,
  variables, categorization, annotations, exports, crops, filtering, sets, and
  the workspace document.
- The workspace document has three sections: `data` (named data sources),
  `spec` (the json-render dashboard), and `state` (coordination cells).
  `frontend/core/workspace/document.ts` validates all of it and is pure, so the
  server and the browser run the same rules.
- `WorkspaceDocumentStore` (`server/workspace.ts`) owns the session's one
  revisioned workspace document and its file. A missing file is written from
  the preset (`server/presets.ts`): a built-in JSON document under
  `apps/ndea/src/presets/` or a `.json` path. Every writer (browser sync,
  `PATCH /api/workspace`, MCP) goes through `applyWorkspacePatch`
  (`server/routes/workspace.ts`): RFC 6902 ops against a base revision,
  checked by `parseWorkspaceDocument` (structure, component props, data
  references, bindings) and for set references. `workspace/watch` pushes
  accepted revisions.
- `workspaceResult` (`server/routes/workspace.ts`) evaluates one element or
  data source: `GET /api/workspace/elements/:id` and
  `GET /api/workspace/data/:name` return `{ revision, predicate, count }`. The
  predicate comes from `elementPredicate` / `dataSourceSql`
  (`frontend/core/workspace/data-sources.ts`), the same functions the browser
  runtimes use. SQL built from document values runs through
  `server/observations.ts`, which prepares every statement
  (`DatasetQuerySession.querySingleJson` / `executeSingle`).
- `ObservationSets` (`server/observation-sets.ts`) stores lassos as
  content-addressed sets keyed by dataset and obs name: `POST /api/sets`
  persists `~/.ndea/sets/<id>.json` and loads rows into the `ndea_obs_sets`
  temp table that `{ op: "inSet" }` clauses query. A saved selection is a data
  source `{ where: { op: "inSet", set } }`. `PATCH /api/workspace` rejects
  references to unknown sets anywhere in the document.
- `/mcp` (`server/mcp.ts`) serves MCP over Streamable HTTP with the SDK's
  per-request `createMcpHandler`; tools close over the one server session.
  Only localhost `Host`/`Origin` and the bearer token in `~/.ndea/mcp-token`
  pass. `edit_dashboard` compiles named ops on a draft document
  (`server/workspace-edits.ts`) and applies the diff as one patch; add new
  agent operations there, not as new write paths.
- `EmbeddingStore` owns one DuckDB connection. Base tables, the `dataset` view,
  temporary selections, and Mosaic preaggregations share that connection.

### SDK

- A view component is an `@ndea/sdk` `ComponentDefinition`: `type` (the
  element `type`), `title`, `documentation`, a config contract
  `{ schema, defaultValue }`, `binds` (the coordination types it can join;
  validation metadata, not a gate), and a lazy `load()` returning a
  `ComponentModule` that mounts a framework-neutral body. The element's props
  are its config, merged over `defaultValue`.
- `ComponentHost` is one plain interface: every service (data, `predicate`,
  `dataAPI`, focus, filter, colorBy, viewSync, ordering, GPU lease) is always
  present. `createComponentHost` (`frontend/core/component/runtime/host.ts`)
  builds it; `predicate` is the element's data source AND its filter scope.
- There is no plugin system: every component is built in. Third-party
  component registration is future work.

### Frontend

- React 19 renders the dashboard.
- TypeGPU drives the WebGPU scatter plot, including GPU lasso and marquee
  selection.
- Mosaic and server-side DuckDB drive cross-filtered scatter, table, and chart
  views. The `vgplot` component renders its props (`entries`, `attributes`) as
  a Mosaic plot spec with the host-supplied `$table`, `$scope`, and `$brush`
  params.
- `DatasetSessionProvider` owns metadata, trajectories, query infrastructure,
  and the session-local runtime manager.
- json-render renders the document's `spec` (`workspace/DashboardPane.tsx`).
  `workspace/dashboard.ts` holds the component catalog (`COMPONENTS`: layout
  `split`/`stack`, `text`, `select`, `slot`, and one component per view
  definition, keyed by its type), the structural and prop rules, and the
  pure edit operations the UI and agents share. Components get element ids
  through a render-only `elementId` prop; props resolve json-render
  expressions against coordination `state`.
- A data component reads `props.data` (a named source; omitted means every
  observation). Sources chain through `from` and narrow by a typed `where`
  clause and/or a `sql` predicate.
- Every document write goes through `Workspace.commit`; local edits,
  coordination writes, and remote revisions (`Workspace.applyDocument`) share
  that path. `WorkspaceSync` diffs the document store against the server's
  acknowledged revision and PATCHes the difference.
- `ComponentRuntimeManager` (`core/component/runtime/workspace-runtime.ts`) keeps
  one live body per view element in a stable dock that tiles adopt, so moving
  a tile never remounts it. A config change from another writer (an agent, a
  remote revision) restarts the body; the body's own `patchConfig` does not.
- Coordination is document data. `state[type][scope]` holds shared values and
  an element prop `{ $bindState: "/<type>/<scope>" }` (json-render's two-way
  binding) joins it to a scope; `frontend/core/coordination/types.ts`
  registers each type's Zod schema (focus, filter, colorBy, viewSync,
  ordering). A `filter` scope is a crossfilter `source → facet → FilterClause`
  keyed by element id: each member sees every other source's clauses, never
  its own, and agents write under their own source key. Publishers emit typed
  clauses, never SQL.

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
vp check vite.config.ts scripts
vp run -r check
vp run -r test

# Production binary: dist/ndea
vp run build

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

Dashboard layout editing (split, swap, remove, fill a slot) runs in
development. Production builds compile it out; agents and patches edit any
build.

## Code rules

- Use `import type` for type-only imports.
- Use double quotes, semicolons, trailing commas, and Oxfmt defaults.
- Use `@/` for `apps/ndea/src/frontend/` imports.
- Say component, not node: a dashboard view is a `defineComponent` definition
  in `@ndea/components`, added to `createComponentCatalog` (`catalog.ts`).
- Name ordinary modules in kebab case, React component modules in PascalCase,
  and hooks with `useX`.
- Route frontend schema mutations through `/api/categorize` and
  `/api/var-column`; Mosaic SQL blocks client-side `ALTER` and `UPDATE`.
- The Crust CLI's root action is `view` (`cli/index.ts`): a subcommand name
  wins over a same-named relative path, so `ndea ./doctor` still means view.

## Load-bearing constraints

- **Mosaic cache:** `QueryManager` keys results by raw SQL. Predicates that
  reference mutable temporary tables need a revision-specific SQL suffix.
- **Mosaic SQL:** The allowlist must permit Mosaic's `CREATE SCHEMA`,
  `CREATE TABLE`, `DROP TABLE IF EXISTS`, and `DROP SCHEMA` statements.
- **DuckDB views:** `ALTER TABLE obs_base ADD COLUMN` invalidates the `dataset`
  view schema. Rebuild it through `EmbeddingStore._rebuildView()`.
- **Workspace authority:** The server document is the only persisted workspace.
  Never write workspace state to `localStorage`. Session state (selection,
  fullscreen) lives in `Workspace.session`; add new editor-only fields to
  `WorkspaceSession` in `workspace/types.ts`. The file
  format accepts only its exact version; there are no migrations.
- **Workers:** `new URL("./worker.ts", import.meta.url)` must work in development
  and compiled binaries. Bun embeds workers automatically.
- **Static files:** Development reads `dist/frontend/`; compiled binaries read
  `$bunfs/`. Both paths use `Bun.file()`.
- **Native addon:** `duckdb.node` embeds in the binary and prevents
  cross-compilation. Build on each target platform. On darwin-arm64,
  `scripts/build-duckdb-addon.ts` compiles duckdb-node-neo's bindings against
  DuckDB's release static libs (pinned by the installed
  `@duckdb/node-bindings` version, cached in `apps/ndea/.duckdb-addon-cache/`),
  so that binary embeds no libduckdb and extracts nothing to `~/.cache/ndea/`.
  Other targets still embed libduckdb for `preload-libduckdb.ts`.
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
