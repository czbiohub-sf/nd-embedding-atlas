## [unreleased]

### 🚀 Features

- _(scatter)_ 3D scatter plots. An embedding with three or more columns gets a `3d` toggle and a Z dimension picker in the Scatter toolbar; the element's new `zDim` prop (also settable by agents through `edit_dashboard`) persists it. Drag orbits, right- or Ctrl/Cmd-drag pans, the wheel dollies toward the cursor, `persp`/`ortho` switches the projection, and Fit view frames the data. Zoomed-in views draw opaque depth-tested discs; overviews use the density path. Lasso and marquee select everything that projects inside the shape, occluded points included; a click focuses the front-most point. `viewSync` cells gain optional `yaw`, `pitch`, `distance`, `target`, and `projection`: 3D scatters on one scope orbit together and 2D views ignore 3D cells. `/api/scatter-positions` takes an optional `z_col` (400 when the embedding lacks that column) and now returns position columns (x, then y, then z) instead of interleaved pairs. The trajectory overlay is 2D-only and hidden in 3D.
- _(scatter)_ Faster scatter at scale. Lassos and filters move as row bitmasks (`/api/sets` accepts a binary bitmask; no 5M-row cap), the lasso readback no longer reports a stale selection, and a new TypeGPU render core (one camera matrix, SoA buffers at ~15 B/point instead of 64, compaction + indirect draws, a density splat when too many points are visible, GPU id picking) draws a 10M-point fit view in ~3–4 ms of GPU time instead of ~41 ms. In density mode the compaction pass only estimates the visible count.
- _(cli)_ Installed binaries print an "Update available" notice (stderr) after a command when a newer stable release is out, checking at most once a day and showing each version once. The command shown is `ndea self update`, or `mise upgrade …` for mise installs. The docs site publishes the latest release at `registry/ndea`; the Release workflow redeploys it.
- _(cli)_ `ndea view` in a terminal shows a live status screen with three tabs: Overview (a card per dataset: format, obs × var, obs columns, MuData modalities, its embeddings, plate wells and channel colors, path and size on disk; plus the workspace revision and last change), Activity (the newest 50 workspace revisions by actor), and Logs (the server's last 200 console lines, warnings and errors highlighted, which no longer draw over the screen). Tab or 1-3 switches, `o` opens the dashboard, `c` copies the URL, `q` stops the server, `--no-tui` keeps log output. `ndea status [--json]` shows the same for a running server via the token-guarded `GET /api/status`.
- _(frontend)_ History panel (status bar → "last change"): every workspace revision with its actor (`browser`, `cli`, `system`, or the agent name such as `omp`), age, op count, and "restored #N"; selecting one compares it with the current dashboard element by element (added, removed, type, props, layout, data sources, state cells), and Restore commits it as a new revision. The status bar shows the last change's actor and age and highlights when an agent or another tab writes.
- _(server)_ Workspace history: every accepted write is recorded in `<workspace>.history.sqlite` beside the workspace file with its actor (`browser`, `cli`, `mcp` plus the `X-Ndea-Agent` name, or `system` for the seed), ops, and time, committed together with the file. `GET /api/workspace/history`, `GET /api/workspace/revisions/:n`, and `POST /api/workspace/restore` (an earlier revision committed again as a new one); `workspace/watch` now pushes the full revision record. `ndea workspace history` and `ndea workspace restore <n>`; MCP tools `get_history` and `restore_revision`. `ndea mcp install` writes an `X-Ndea-Agent` header per agent.
- _(axial)_ Vendor axial I/O library for zarr/AnnData/MuData reading
- _(server)_ DuckDB EmbeddingStore + Mosaic query protocol
- _(cli)_ CLI entry point with YAML config and startup orchestration
- _(server)_ Bun.serve HTTP + WebSocket server with route handlers
- _(build)_ Bun build --compile single binary with embedded frontend
- Wire up embedding loading from zarr to DuckDB
- _(server)_ Wire var names, layers, and gene-column materialization
- _(server)_ OME-Zarr HCS plate static serving + metadata extraction
- _(server)_ Implement /api/crop via zarrita + zero-dep PNG encoder
- _(server)_ Integrate d3-scale-chromatic for colormaps/palettes
- _(server)_ Implement Parquet export via DuckDB COPY TO
- _(server)_ Add WebP crop encoding via @jsquash/webp
- _(server)_ Zod schemas at every req.json() boundary
- _(build)_ Get `bun build --compile` working end-to-end
- _(frontend)_ Let fixed presets split, resize, remove, and restore stage panels
- _(frontend)_ Draw coordination on the wiring canvas: a hub per scope and a link per binding; delete a link to unbind, drag a hub onto a node to bind. Canvas selection now lives in the editor session, so the wire delete chip shows on selection.
- _(server)_ MCP server at `/mcp` (Streamable HTTP, localhost-only, bearer token in `~/.ndea/mcp-token`): agents read the workspace, nodes, columns, and results, and edit the data flow (`edit_graph`) and the views (`edit_view`) through atomic named ops, with `patch_workspace` as a raw escape hatch.
- _(cli)_ `ndea mcp install | check | uninstall`: detect installed coding agents (via add-mcp), write ndea's MCP endpoint and token into their configs, and report which agents are current.
- _(server)_ Every workspace write now gets the same graph check as a document load (configs, ports, cycles), so no writer can save a document the browser would refuse to open.
- _(frontend)_ json-render composes the whole dashboard from the document's `spec`: layout (`split`, `stack`), `text`, a `select` picker that publishes typed `in` clauses, empty `slot`s, and one component per view (`scatter`, `table`, `count`, `count-plot`, `histogram`, `vgplot`, `gallery`, `image-viewer`, `annotate`) whose props are its settings. `vgplot` renders any Mosaic plot spec in its props.
- _(server)_ Named data sources (`/data`: `from` + typed `where` and/or `sql`) replace transform nodes; `GET /api/workspace/elements/:id` and `/api/workspace/data/:name` return the same predicate and count the browser shows. MCP tools are now `list_components`, `get_result`, and `edit_dashboard`.

### 🐛 Bug Fixes

- Wire CLI startup to createApp, fix DuckDB ingestion
- Metadata props.data schema, dev script, frontend scripts cleanup
- _(frontend)_ Fall back to first available obsm key when none loaded
- _(frontend)_ Format non-scalar table values without implicit object stringification
- _(server)_ Return DuckDB BIGINTs as JS numbers when safe
- _(frontend)_ Clear ExportDialog setInterval on unmount
- _(frontend)_ Clear useVarColumn poll interval on unmount
- _(frontend)_ Abort in-flight embedding load on unmount
- _(build)_ Keep embedded frontend and DuckDB source manifests as stable development stubs
- _(server)_ `PATCH /api/workspace` and MCP writes now reject a document whose typed clauses (a data source's `where`, a `state.filter` clause) name a column the dataset lacks, with a JSON-pointer issue per clause (e.g. `/data/bad/where/column`); raw `data.sql` is still checked only when it runs. Startup logs the same issues for the workspace file instead of refusing it.
- _(server)_ `/data/metadata.json` `obs_columns` now lists annotation columns restored from a cached ingest, and drops configured `--obs-columns` names the dataset does not have

### 🛡️ Security

- _(server)_ `/api/categorize`, `/api/scatter-categories`, `/api/scatter-continuous-values`, and `/api/trajectory` resolve request column names against the dataset's column catalog (400 `Unknown column` otherwise) and quote every identifier with `quoteIdent`; a name like `x" ; DROP TABLE obs_base; --` could previously break out of the bare `"${column}"` quoting

### 🚜 Refactor

- [**breaking**] _(build)_ Build and serve on Bun primitives. The binary is a full-stack executable: the server imports `index.html` and `Bun.serve` routes `/*` to it (dev server with HMR under `--dev`, the embedded production bundle in the binary, code-split so component chunks load on demand). `server/static.ts`, the generated asset manifest, `dist/frontend/`, and the `build:frontend` task are gone; `vp run build` is `build:addon` then one compile. The API is one declarative `routes` table; an unlisted method on a known route now returns 405 with `Allow` (it was the 404 `Unknown API endpoint`). The binary compiles to ESM bytecode laid out by committed `bytecode-order` profiles (`vp run bytecode-order` re-records them) and embeds sourcemaps, so stack traces show `src/**/*.ts:line`. On macOS arm64, warm `--version` and `--help` take 33 ms instead of 102 ms and `view` reaches Ready in 157 ms instead of 233 ms; the binary is 160 MB instead of 132 MB.
- [**breaking**] One dev server and one task set. `vp run dev` is a single Bun process (Bun's fullstack dev server: frontend with HMR, API, `/data/query`, `/ws`, `/mcp` on one port) behind portless at `https://ndea.localhost`; a linked worktree gets `https://<last branch segment>.ndea.localhost`, and `PORTLESS=0` skips the proxy. It opens `../ome-atlas-test-data/infectomics/infectomics.yaml`, or the synthetic dataset with `--fixture`. Vite no longer serves the app; dev and production share Bun's bundler and plugins. Tasks: `dev`, `ndea`, `verify` (cached check + test of root tooling and every workspace; CI and the worktree pre-merge hook run it), `check`, `test`, `build` (cached `build:frontend` and `build:addon`, then compile), `docs`, `docs:build`, `docs:serve`, `audit`, `release:version`. Removed: `backend`, `dead-code`, `dev:fixture`, `docs:dev` (now `docs`), `sync-version` (now `release:version`), the app-level `dev`/`build` scripts, and `vp dev apps/ndea`. Every workspace tests with `bun test` (`bun:test` imports).
- _(cli)_ Regroup the CLI: `ndea filter` is now `ndea workspace query`, and `ndea update` / `doctor` / `gc` are `ndea self update` / `self doctor` / `self prune` (same flags, including `self update --no-gc`); the old names are gone. `workspace *`, `mcp check`, and `mcp install` read `NDEA_HOST` / `NDEA_PORT` when `--host` / `--port` are omitted. New `ndea man` prints the manual page. Output uses one palette (periwinkle accent, dim labels, green ✓, amber !, red ✗) that `--no-color`, `NO_COLOR`, and non-terminal stdout turn off entirely; `view` shows spinners while opening datasets and loading DuckDB, and `self update` shows download progress, both as plain final lines when piped. Every failure renders as one `✗` line on stderr with the same exit codes; `workspace` commands still pass the server's JSON error body through to stderr verbatim. The startup banner shows the real version.
- _(build)_ On macOS arm64, link DuckDB statically into `duckdb.node` (`scripts/build-duckdb-addon.ts`: duckdb-node-neo bindings plus DuckDB's published static libraries, compiled by `clang++` and cached per DuckDB version). The binary no longer embeds or extracts `libduckdb`: 132 MB instead of 199 MB, and first launch goes from 4.5 s to 0.5 s. Other targets keep the embedded `libduckdb`, and dev mode keeps the npm addon.
- _(cli)_ Move the CLI from Bunli to Crust. Every command, flag, and default keeps its name; `ndea <path>` still runs `view`. Output is plain text, with no `{ ok, data }` envelope for agents or CI: JSON commands (`filter`, `workspace`) print the server's JSON as-is, and `ndea --version` prints only the version. Shell completion is `ndea completion <bash|zsh|fish>`; scripts are static (no `ndea complete` callback, no `.bunli/` metadata or `vp run gen`), and `view` paths use plain file completion.
- Update every dependency to latest: Bun 1.4.3, Vite+ 1.3.0 (and its `vite` core override), Mosaic 0.33, DuckDB 1.5.6, idetik 0.48, React 19.3, zod 4.6. Mosaic 0.33 removed its socket connector, so the browser queries `/data/query` through `restConnector` and the `/mosaic` WebSocket adapter is gone. Code now passes Vite+'s React Compiler lint rules; virtualized lists use a package-owned `useVirtualizer` over `@tanstack/virtual-core` in place of `@tanstack/react-virtual`.
- Route dependency management, tasks, checks, builds, and development through Vite+
- Convert the product to a Bun/Vite+ monorepo with app, protocol, SDK, and Zarr workspaces
- Extract Ochre, UI, built-in nodes, and graph evaluation into package-owned workspaces
- Harden plugin capabilities, NodeHost services, topology validation, and graph semantics
- Centralize capability categories, documentation, plugin permissions, host grants, and service requirements in `apps/ndea/src/frontend/core/node/capabilities.ts`; new capabilities require that registry and the SDK union in `packages/sdk/src/node.ts`.
- Inline built-in view host calls, remove forwarding-only routing exports and tests, and drop Gallery's unused selection input.
- [**breaking**] Store a pinned Cache as an observation set in its node config, so pins survive reload and agents read the same rows; delete the runtime checkpoint machinery.
- [**breaking**] Delete the `sel` port kind and graph emissions; `pred` is the only port kind.
- Make the browser graph runtime a projection of the workspace document: every write commits through one reconcile, and views and live Caches cook their own filter scope, identically on the server.
- [**breaking**] Replace the node graph with json-render: the workspace document (format version 2) is `data` + `spec` + `state`. Delete the graph engine (`@ndea/graph`), cooks, edges, ports, subnets, node assets, the xyflow canvas, per-node layout and flags, the `bindings` map (bindings are `$bindState` element props), the frontend plugin catalog, and the Cache, Wrangle, Filter, Dataset, obs, and proxy nodes.
- [**breaking**] SDK 1.0.0: `NodeDefinition` drops `role`, `inputs`, `outputs`, `evaluate`, and `dataRequirements`; config contracts are `{ schema, defaultValue }` with no versions or migrations.
- [**breaking**] SDK: components with one typed host. `ComponentDefinition` is `{ type, title, documentation, config, binds, load }`; `ComponentHost` always carries every service (`elementId`, `predicate`, `viewSync`, …). Capabilities, exact type refs, versions, and `createRuntime` are gone. `@ndea/nodes` is now `@ndea/components`.
- Move editor session state (selection, claim, subnet path, disposition, render band) into `Workspace.session`; the document store holds exactly the persisted document.
- Run every document-derived observation query through prepared statements in `server/observations.ts` and delete `/api/scatter-selection`.
- Adopt TypeScript 7 and update app, package, build, and documentation dependencies
- Align shared controls and node toolbar states with scheme-aware theme tokens
- Remove accidental root dependencies and tune Fallow for package-owned ambient checks
- [**breaking**] Replace Python backend with Bun + TypeScript scaffold
- _(scatter)_ Remove dead PiP branch; detach via FloatingScatterRoot only
- _(server)_ Collapse prepare.ts into state.ts
- _(scatter)_ UseQuery for category-column mapping
- _(axial)_ Drop ~820 lines of dead WebSocket/worker-pool/streams scaffolding
- Flatten src/axial/{core,conventions,store}/ → src/zarr/
- Collapse frontend/package.json → single root package.json
- Collapse frontend/ into src/frontend/, one vite.config + tsconfig
- Consolidate all wire-crossing Zod schemas into src/protocol/
- _(server)_ Delete the plugin system: discovery, manifests, `/api/plugins/bootstrap` and `/plugins/*` assets, `ndea plugin`, YAML `plugin_paths`, and the SDK `PluginAPI`/`PluginFactory`/manifest schemas and `SDK_VERSION`
- _(server)_ Delete the `embeddings/load|status`, `var-column/load|status`, and `export/start|status` WebSocket methods; the HTTP routes remain and `/ws` serves only `workspace/watch`
- _(server)_ Delete the `/mosaic` WebSocket adapter; Mosaic 0.33 dropped `socketConnector`, so the browser `Coordinator` uses `restConnector` against `/data/query`
- _(server)_ `DatasetQuerySession.columns()` is the one column catalog (name → `{ sqlType, kind }`, refreshed on every `dataset` VIEW rebuild); MCP `list_columns` reads it and adds each column's `kind`. `ServerSession.obsColumns`/`port`, `datasetColumnExists`, `invalidateSchemaCache`, and external `_rebuildView` calls are gone; `/api/categorize` adds its index column through `addObsIndexColumn`
- [**breaking**] _(server)_ Delete `GET /api/config` and the protocol `ConfigResponseSchema`; nothing called it, and `/data/metadata.json` carries the same facts

### ⚙️ Miscellaneous Tasks

- _(frontend)_ Switch to bun, document API contract for server port
- Drop unused deps + merge duplicate resolveFrontendDir
- _(server)_ Review cleanup: try/catch dedup, colormap wire-up, Bun concat

## [0.0.3] - 2026-04-09

### 🐛 Bug Fixes

- Serve per dataset plate channels to idetik (#51)

### 🚜 Refactor

- _(scatter)_ Composable GPU isolation masks + materialized view compositor (#48)

## [0.0.2] - 2026-04-08

### 🐛 Bug Fixes

- _(scatter)_ Clear stale **ev**\* category column after backend restart (#45)
- Switched out custom i/o for anndata for the i/o built in to anndata and scanpy's get (#46)

### 📚 Documentation

- Update installation docs with uv tool / uvx (#43)

## [0.0.1] - 2026-04-06

### 🚀 Features

- Getting started
- Learn to read: h5ad edition (#15)
- Added exporting to anndata (#20)
- Ndimg: FOV table, idetik viewer, channel controls (#17)
- Added colormaps (#38)

### 🐛 Bug Fixes

- Correct trajectory, T slider, bbox, and CSS in image viewer (#3)
- Allows reading ops anndata files (#16)
- Made column widths adjustable in the table (#29)
- Categories in the legend can be toggled on and off (#34)
- Fixed selection-table sync (#39)

### 🚜 Refactor

- Removed ome_atlas/vz directory, slipped through the renaming

### 📚 Documentation

- Added documentation and example data
- Added docs link to the readme
- Added pnpm to the getting started / contributing

### ⚡ Performance

- Improvements for loading datasets (#25)

### ⚙️ Miscellaneous Tasks

- Remove .readthedocs.yaml, using github pages
- Added issue triage workflow (#9)
- Update release workflow (#42)
