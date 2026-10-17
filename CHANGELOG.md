## [unreleased]

### 🚀 Features

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

### 🚜 Refactor

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
