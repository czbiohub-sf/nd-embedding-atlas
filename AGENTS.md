# nd-embedding-atlas

Interactive browser-based dashboard linking AI embeddings to source 5D (TCZYX)
image data. json-render composes the whole UI from one workspace document.
APIs remain in flux.

## Runtime and tooling

- Use Vite+ (`vp`) as the only developer-facing command interface: dependency
  management, package scripts, workspace tasks, checks, tests, builds, and the
  dev server all start with `vp`.
- Bun remains the runtime, package manager, bundler, dev server, test runner,
  script host, and binary compiler underneath Vite+. Package scripts and
  low-level tooling may invoke Bun; developers should not invoke it directly.
  Do not use Node.js, npm, pnpm, Yarn, or Python.
- Import config APIs from `vite-plus` and test APIs from `bun:test`. Vite+
  only checks, lints, formats, and runs tasks; it does not serve or bundle the
  app. Do not install Vite, Vitest, Oxlint, Oxfmt, or tsdown separately.
- Run tasks with `vp run <task>`. Bare commands such as `vp build`, `vp dev`,
  and `vp test` invoke Vite+ built-ins, not the project's tasks.
- Cached tasks (`check`, `test`, `verify`, `build:*`) live in the root
  `vite.config.ts` `run.tasks`; uncached ones are root `package.json` scripts.
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

- DuckDB reads AnnData and MuData values through the duckdb-zarr extension
  (`read_zarr`). `server/zarr-extension.ts` `openDuckDB` is the one place a
  DuckDB instance opens: unsigned extensions allowed, then `LOAD` of the build
  for the installed DuckDB (`.zarr-ext-cache/` from a checkout, extracted from
  the binary otherwise). `ndea self doctor` reports it.
- `server/zarr-ingest.ts` builds `obs_base` and `var_base` in SQL for a
  single store, a union (`UNION ALL BY NAME` + `_dataset`), and MuData
  (modalities through `group_path`, root obs/var decoded from raw arrays,
  modality columns `<mod>:<col>` on collision, var tagged `_modality`).
  Positions are `row_number() OVER ()` of the scan, asserted against each index
  array (`array_path := '<axis>/_index'`) on every ingest. Gene columns:
  sparse `X`/layers through `read_zarr`, dense through
  `AnnData.readDenseColumn` (no filter pushdown upstream yet).
- String categoricals arrive as `ENUM` and are stored as VARCHAR: nanoarrow's
  `to_arrow_ipc` cannot encode Arrow dictionaries and fails with a FATAL error
  that invalidates the database. Bool and nullable-int columns are BOOLEAN and
  INTEGER on every path. `read_zarr` renames a column named after its axis
  (`obs/obs`) and columns that differ only in case (their store paths); the
  catalog shows those names and workspace validation flags references to the
  old ones as unknown columns.
- `@ndea/zarr` opens AnnData, MuData, and OME-Zarr stores through zarrita and
  `BunFileStore`, metadata only: `FrameMeta` (index name, columns,
  encodings, length), obsm shapes and columns for the scatter, dense matrix
  columns, and `commitObsColumns` (obs write-back).
- Rows that start in JS (annotations, dense gene columns) go through
  `server/append-columns.ts` `appendColumns`: typed arrays copied into
  `DuckDBDataChunk`s, never per-row appends or SQL `VALUES`.
- `BunFileStore.getRange` supports `{ offset, length }` and `{ suffixLength }`.
  Zarr v3 sharding needs suffix reads for shard indexes.

### Server

- `createApp()` in `apps/ndea/src/server/app.ts` creates the Bun HTTP and
  WebSocket server from one `Bun.serve` `routes` table. Add an endpoint as an
  `api({ "/api/x/:id": { GET } })` entry: it gets CORS, a 204 preflight, and a
  405 with `Allow` for unlisted methods; unknown `/api/*` paths return 404
  `{ error: "Unknown API endpoint: …" }`.
- `/data/query` serves Mosaic's `restConnector` (`POST { type, sql }`;
  `arrow` returns Arrow IPC bytes, `exec` returns `{}`).
- `/ws` carries the framed `{ _id, _type }` ndea protocol: `workspace/watch`
  (committed revisions) and `harness/watch` (MCP agents and when each was
  last seen, for the rail's harness presence).
- Remote rendering (`server/remote-render.ts`, `server/chrome.ts`): an
  image viewer with `render: "remote"` opens `/ws/render` (one session per
  socket; the session dies with it). The server lazily launches one headless
  Chrome (`NDEA_CHROME`, platform paths, PATH, Playwright's
  `chromium-headless-shell`) and drives it over `--remote-debugging-pipe`,
  never a debugging port; each session is a tab at
  `/render/image?element=…&session=…`, which renders only that element's
  body (`WorkspaceShell` `RenderFrame`, `RENDER_PAGE` in
  `core/component/definitions.ts`). In that tab `RenderPageBridge` encodes
  the viewer canvas (plus `[data-viewer-overlay]` boxes) with WebCodecs,
  publishes viewer state, and applies the tile's actions; the tile's
  `RemoteViewerProvider` decodes, mirrors that state into the same viewer
  controls, and sends pointer/wheel input, which the server replays as CDP
  mouse events. Shutdown closes Chrome; `ndea self doctor` probes it.
- REST routes cover health, embeddings, observations, scatter data,
  variables, categorization, annotations, exports, crops, filtering, sets, and
  the workspace document. `GET /api/status` (the runtime snapshot) and
  `GET /api/status/datasets/:name/structure` take the MCP bearer token because
  they expose filesystem paths.
- Trust model: local trust. `ndea view` binds 127.0.0.1; reach a remote
  server through SSH forwarding. `/ws`, `/ws/render`, `/plate/*`,
  `/data/query`, and the REST data routes are unauthenticated by design under
  that model; `/mcp` adds loopback `Host`/`Origin` plus the bearer, and the two
  status routes take the bearer. `--host` with a non-loopback address prints a
  startup warning; it adds no auth.
- The workspace document has three sections: `data` (named data sources),
  `spec` (the json-render dashboard), and `state` (coordination cells).
  `frontend/core/workspace/document.ts` validates all of it and is pure, so the
  server and the browser run the same rules.
- `Workspace` (`server/workspace.ts`) owns the session's one revisioned
  workspace document, its file, and its history. A missing file is written
  from the preset (`server/presets.ts`): a built-in JSON document under
  `apps/ndea/src/presets/` or a `.json` path. Every writer (browser sync,
  `PATCH /api/workspace`, CLI, MCP) goes through `workspace.patch` (or
  `restore`): RFC 6902 ops against a base revision, serialized, checked by
  `parseWorkspaceDocument` (structure, component props, data references,
  bindings), then by the `validate` injected at `Workspace.open`:
  `workspaceIssues` (`server/routes/workspace.ts`) for unknown set references
  and typed clauses (data-source `where`, `state.filter`) naming columns the
  dataset lacks. Raw `data.sql` is checked only when it runs. Startup logs the
  same issues for the workspace file instead of refusing it. The accepted
  document is deep-frozen (`get()` hands out that object; ops apply to a
  `structuredClone`), so a reader can't mutate it around `patch`.
- Each accepted write appends a row (revision, base, actor, ops, document,
  time, `restoredFrom`) to `<workspace>.history.sqlite` (`bun:sqlite`) in the
  same transaction as the atomic JSON write; a failed write rolls the row
  back, and watchers hear only committed revisions. Opening a workspace whose
  history lacks its revision adds a `system` baseline row. The server stamps
  the actor from the transport, never the body: `browser`, `cli` (the
  `X-Ndea-Client: cli` header `cli/lib/server.ts` sends), or `mcp` with the
  agent from `X-Ndea-Agent`. Actors are provenance, not authorization.
  `GET /api/workspace/history`, `GET /api/workspace/revisions/:n`, and
  `POST /api/workspace/restore` (revision N committed again as a new
  revision) expose it; `workspace/watch` pushes each committed revision
  record.
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
  temp table that `{ op: "inSet" }` clauses query. DuckDB builds the set
  (sort, key file, `COPY` of the set file); JS only hashes the key bytes, so
  the id stays sha256 of the sorted `dataset\0obs_name` keys. A saved selection is a data
  source `{ where: { op: "inSet", set } }`. `PATCH /api/workspace` rejects
  references to unknown sets anywhere in the document.
- `/mcp` (`server/mcp.ts`) serves MCP over Streamable HTTP with the SDK's
  per-request `createMcpHandler`; tools close over the one server session and
  the request's actor. Only loopback `Host`/`Origin` (localhost, 127.0.0.1,
  [::1], `*.localhost`) and the bearer token in `~/.ndea/mcp-token` pass.
  `edit_dashboard` compiles named ops on a draft document and applies the diff
  as one patch. The browser's `WorkspaceStore.apply` runs the same ops; new
  agent operations go in `core/workspace/edits.ts`, not as new write paths.
  Element ids in tools accept a view reference `ndea://<workspace>/<id>`
  (`resolveElementId`, same module); another workspace's reference is rejected.
- `DatasetQuerySession` (`server/store.ts`) owns one DuckDB connection and the
  `dataset` VIEW: obs_base plus var and annotation joins. Base
  tables, the VIEW, temporary selections, and Mosaic preaggregations share that
  connection. `columns()` is the VIEW's column catalog (name → `{ sqlType,
  kind }`), refreshed on every VIEW rebuild; resolve any request- or
  document-supplied column name against it and interpolate it with
  `quoteIdent`, never a bare `"${name}"`. Mosaic's `/data/query` keeps its own
  statement allowlist.

### SDK

- A view component is an `@ndea/sdk` `ComponentDefinition`: `type` (the
  element `type`), `title`, `documentation`, a config contract
  `{ schema, defaultValue }`, `binds` (the coordination types it can join;
  validation metadata, not a gate), and a lazy `load()` returning a
  `ComponentModule` that mounts a framework-neutral body. The element's props
  are its config, merged over `defaultValue`.
- Config fields carry Zod `.meta({ title, section: "display" | "data",
  control: "column" | "obsm" | "dataset", hidden })` (`ConfigFieldMeta` in
  `@ndea/sdk`). `core/workspace/config-fields.ts` turns a schema into fields
  and `ViewSettings.tsx` renders the gear popover from them (switch, segmented
  for 2–3 options, select, slider when the range is explicit). Mark a field
  `hidden` when the view itself already has the control.
- `ComponentHost` is one plain interface: every service (data, `predicate`,
  `dataAPI`, focus, filter, colorBy, viewSync, ordering, GPU lease) is always
  present. `createComponentHost` (`frontend/core/component/runtime/host.ts`)
  builds it; `predicate` is the element's data source AND its filter scope.
- There is no plugin system: every component is built in. Third-party
  component registration is future work.

### Frontend

- React 19 renders the dashboard. Design tokens (color, type, radius,
  elevation, motion) live in `packages/ui/src/tokens.css`, from the design
  handoff's `design-system/tokens/`; `packages/ui/src/styles.css` maps them to
  Tailwind utilities. Dark (`.dark` on `<html>`) is the default; there is no
  glass or blur. Overlays share one frame (`popoverFrame` in
  `@ndea/ui/components/popover`).
- The shell (`core/shell/Shell.tsx`): a 32px rail whose flyouts (Layouts,
  Data, Links, Harness, Settings) open over the tiles on hover and dock when
  pinned (click or ⌘B). No top bar, status bar, or revision UI: history stays
  on the server (REST, CLI, MCP, TUI).
- A view tile's 30px header: its tab, the embedding chip (embedding views),
  then the link indicator + popover (`LinksPopover.tsx`: each link's value,
  members, Unlink; hovering highlights member tiles through
  `WorkspaceSession.highlightedElementIds`), the view settings gear, copy
  reference (`reference.ts`: `ndea://<workspace name>/<element id>`), and
  fullscreen. Right-click it to split or remove the tile.
- The image viewer's top-left overlay holds Channels (visibility, named
  colormaps, contrast over the channel-stats log histogram, auto contrast) and
  View (T/Z, 2D/3D, focus box, volume, local/remote render); a scale bar in the
  OME-Zarr axis unit sits bottom-right.
- TypeGPU drives the WebGPU embedding view (`packages/components/src/scatter/gpu/gpu/`):
  SoA position columns (`/api/scatter-positions` sends the element's
  `xDim`/`yDim`/`zDim` columns of its `obsmKey`), one `project()` shared by every pass,
  compaction + `drawIndirect`, a density splat when too many points are
  visible, and GPU box/lasso on projected positions. `camera.ts` has
  `PanZoom2D` and `Turntable3D`; 3D draws opaque depth-tested discs, and its
  `viewSync` cells carry `yaw/pitch/distance/target/projection` (2D views skip
  them). `scene.ts` stores points in Morton (storage) order with 256-point
  batches and per-batch bounds for culling; that order is internal: every
  scene setter, the selection bitmask, and the pick result speak row order
  (`writeLayer`/`layerToRows`/`perm` translate). Controls float inside the view
  (`ScatterControls.tsx`): a top-left group (pointer/box/lasso, V/B/L; Legend,
  Point size, Axes popovers), the bottom-right axis picker, the pinned legend,
  and the selection pill. Props `xDim`, `yDim`, `zDim`, `pointSize`, `legend`
  (`popover` | `pinned`) and `density.mode` (`mean` | `dominant` | `weave`) persist
  via `patchConfig`. A finished shape combines CPU-side with the selection
  (`selection-bits.ts`: shift adds, ⌥ subtracts, Invert), becomes a set, and
  publishes `{op:"inSet"}` on the `lasso` facet; Save as source writes
  `data["Selection-<n>"]` through `host.dataAPI.saveSource`. 3D selection depth
  is view-local: `through` (everything inside) or `front` (CloudLasso: the
  nearest dense structure).
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
- Every document write goes through `WorkspaceStore.commit`; local edits,
  coordination writes, and remote revisions (`WorkspaceStore.applyDocument`)
  share that path. Views ask it questions (`element(id)`,
  `elementPredicate(id)`, `coordination.filterFacet`/`setFilterFacet`/
  `stateStore`) instead of reading document shape; only `WorkspaceSync`, the
  shell's flyouts, and json-render's spec read `snapshot()`. `WorkspaceSync`
  diffs `snapshot()` against the server's acknowledged revision and PATCHes
  the difference. `compareDocuments` (`core/workspace/compare.ts`) summarizes
  two documents element by element.
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

# Dev server: one Bun process (frontend with HMR, API, /data/query, /ws, /mcp)
# at https://ndea.localhost via portless; a linked worktree gets
# https://<last branch segment>.ndea.localhost. Run from the repo root
# (bunfig.toml carries the frontend plugins); Ctrl+C stops it. Opens
# ../ome-atlas-test-data/infectomics/infectomics.yaml. The first run starts the
# portless proxy (HTTPS on :443, asks for sudo and trusts its CA once);
# `PORTLESS=0 vp run dev` skips it and serves http://localhost:5055.
vp run dev
# Synthetic in-memory dataset instead
vp run dev --fixture

# CLI from source
vp run ndea <args>
# Running server's status (GET /api/status, MCP bearer token): one JSON snapshot
vp run ndea status --port 5055 --json

# Check + test root tooling and every workspace (cached)
vp run verify
vp run check
vp run test

# Production binary: dist/ndea (cached build:addon and build:zarr-ext, then compile)
vp run build
# duckdb-zarr extension for the installed DuckDB (cached; needs cargo)
vp run build:zarr-ext
# Re-record the bytecode-order profiles from dist/ndea, then build again
vp run bytecode-order

# Code-health audit (Fallow)
vp run audit

# Ingest benchmark: synthetic AnnData (Zarr v3) under /tmp/zarr-io-bench/data,
# then cold/warm start, peak RSS and first-use latency of any checkout's `ndea view`
vp run bench:ingest -- generate --n-obs 70k [--union | --mudata]
vp run bench:ingest -- run <dataset.zarr | project.yaml>... [--root <checkout>] [--json]

# Write apps/ndea/package.json's version into src/cli/version.ts before tagging
vp run release:version

# Documentation
vp run docs
vp run docs:build
vp run docs:serve
```

Shared `catalog` constraints live in the root `package.json`; update each
constraint there once, then run `vp install`. Update root-only tooling packages
reported by `vp outdated` explicitly with `vp update <package...>` so Bun does
not replace unrelated `catalog:` references with package-local ranges. Use
`vp add --filter <workspace> <package>` and
`vp remove --filter <workspace> <package>` for targeted workspace changes.

`vp run build` runs the app's Bun build: `build:addon` (static `duckdb.node` on
darwin-arm64) and `build:zarr-ext` (duckdb-zarr, embedded in the binary) are
cached; the compile step always runs and takes
`--target=<bun target>`. It compiles one full-stack executable (the frontend
bundle, ESM bytecode laid out by `apps/ndea/scripts/bytecode-order/*.order`,
and embedded sourcemaps, so stack traces show `src/**/*.ts:line`). Do not use
bare `vp build`; that invokes Rolldown instead of the single-binary pipeline.
Direct `bun build --compile` skips the frontend plugins (Bun's CLI does not
load them); use the project task.

Dashboard layout editing ships in every build: right-click a tile header to
split or remove it, drag its tab to swap tiles, and fill an empty tile from its
component list.

`ndea view` in a terminal shows a live status screen (`cli/tui.ts` on
`@crustjs/tui`/OpenTUI, fed by `server/status.ts`): Overview (dataset cards,
workspace), Activity (revisions), and Logs tabs; `q` or Ctrl+C stops the
server. `--no-tui` or a non-TTY stdout keeps the log lines. `ndea status`
renders the same screen by polling `/api/status`. Per-dataset facts are built
once in `ServerSession.status` (`cli/startup/session.ts`); add new ones there,
not per poll. `captureConsole` keeps the last 200 console lines for the Logs
tab and mutes the terminal while the screen is up, so log through `console`.
OpenTUI's native library loads on import, so keep `cli/tui.ts` lazily imported
and free of frontend imports.

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
  wins over a same-named relative path, so `ndea ./self` still means view.
- CLI commands fail by throwing; the `errors` extension (`cli/lib/style.ts`)
  renders every failure once and exits 1 (130 on Ctrl-C). Do not call
  `process.exit` outside the long-running server's shutdown and startup
  interrupt. Style terminal output only through `cli/lib/style.ts`; commands
  that talk to a running server use the `server` Context (`cli/lib/server.ts`,
  `--host`/`--port`, `NDEA_HOST`/`NDEA_PORT`).

## Load-bearing constraints

- **Mosaic cache:** `QueryManager` keys results by raw SQL. Predicates that
  reference mutable temporary tables need a revision-specific SQL suffix.
- **Mosaic SQL:** The allowlist must permit Mosaic's `CREATE SCHEMA`,
  `CREATE TABLE`, `DROP TABLE IF EXISTS`, and `DROP SCHEMA` statements.
- **DuckDB views:** `ALTER TABLE obs_base ADD COLUMN` invalidates the `dataset`
  view schema. Add columns through `DatasetQuerySession` methods
  (`addObsIndexColumn`, `register*Column`), which rebuild the VIEW and its
  column catalog.
- **Workspace authority:** The server document is the only persisted workspace.
  Never write workspace state to `localStorage`. Session state (selection,
  fullscreen) lives in `WorkspaceStore.session`; add new editor-only fields to
  `WorkspaceSession` in `workspace/types.ts`. The file
  format accepts only its exact version; there are no migrations.
- **Workers:** `new URL("./worker.ts", import.meta.url)` must work in development
  and compiled binaries. Bun embeds workers automatically.
- **Static files:** The server imports `apps/ndea/index.html` and serves it
  from `Bun.serve` `routes` (`/*`, so any non-API path gets the app). `vp run
  dev` (`ndea view --dev`) serves it through Bun's dev server (HMR); a source
  run without `--dev` bundles it on first request; `vp run build` embeds the
  production bundle in the binary. The root `bunfig.toml` `[serve.static]`
  plugin (`scripts/frontend-plugin.ts`, Tailwind + TypeGPU) is the same one
  `build.ts` passes to `Bun.build`.
- **Dev/prod flag:** Frontend code branches on `process.env.NODE_ENV` only (Bun's
  dev server inlines `"development"`, `build.ts` defines `"production"`);
  `import.meta.env` does not exist. `@ndea/components` declares just that global
  in `src/process-env.d.ts`.
- **React Fast Refresh:** `react-refresh` is a root devDependency only so Bun's
  dev server turns Fast Refresh on (it resolves it from the repo root,
  oven-sh/bun#40245); without it every frontend edit is a full reload.
- **Native addon:** `duckdb.node` embeds in the binary and prevents
  cross-compilation. Build on each target platform. On darwin-arm64,
  `scripts/build-duckdb-addon.ts` compiles duckdb-node-neo's bindings against
  DuckDB's release static libs (pinned by the installed
  `@duckdb/node-bindings` version, cached in `apps/ndea/.duckdb-addon-cache/`),
  so that binary embeds no libduckdb and extracts nothing to `~/.cache/ndea/`.
  Other targets still embed libduckdb for `preload-libduckdb.ts`.
- **duckdb-zarr extension:** its builds are `C_STRUCT_UNSTABLE`, so DuckDB loads
  one only if it was built for that exact DuckDB version: rebuild on every
  DuckDB bump. `scripts/build-zarr-extension.ts` (`vp run build:zarr-ext`)
  fetches duckdb-zarr at the commit `server/zarr-extension.ts` pins, pins its
  duckdb-rs crate to the installed `@duckdb/node-bindings` (DuckDB 1.5.6 →
  `1.10506.x`), runs `cargo build --release` in the source tree (its
  `.cargo/config.toml` applies), and appends the extension metadata footer in
  Bun (no Python). Native per platform, like `duckdb.node`; CI pins Rust
  1.99.0. `test`, `build`, `dev`, `ndea`, and `bench:ingest` build it on demand.
- **Updates:** Standalone installs live under `~/.ndea/versions/<tag>/ndea`;
  update atomically repoints `~/.local/bin/ndea` and keeps only the active
  version by default. Mise-managed updates must go through mise and must never
  mutate the standalone tree. Compiled binaries run Crust's `updateNotifier`
  against `registry/ndea` on the docs site (latest stable tag as npm-style
  dist-tags, written by `docs.yml`; `release.yml` dispatches a redeploy).
- **Windows:** Releases ship `ndea-windows-x64.exe`, installed by
  `scripts/install.ps1` to `%LOCALAPPDATA%\ndea\bin`. There is no versions
  tree and no symlink, so `ndea self update` exits early on `win32`; re-running the
  installer is the upgrade path. DuckDB ships the shared library as
  `duckdb.dll`, not `libduckdb.dll`: `libduckdb-cache.ts` owns that name for
  both the preloader and `ndea self doctor`.
