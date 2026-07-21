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

### 🐛 Bug Fixes

- Wire CLI startup to createApp, fix DuckDB ingestion
- Metadata props.data schema, dev script, frontend scripts cleanup
- _(frontend)_ Fall back to first available obsm key when none loaded
- _(frontend)_ Format non-scalar table values without implicit object stringification
- _(server)_ Return DuckDB BIGINTs as JS numbers when safe
- _(frontend)_ Clear ExportDialog setInterval on unmount
- _(frontend)_ Clear useVarColumn poll interval on unmount
- _(frontend)_ Abort in-flight embedding load on unmount

### 🚜 Refactor

- Route dependency management, tasks, checks, builds, and development through Vite+
- Convert the product to a Bun/Vite+ monorepo with app, protocol, SDK, and Zarr workspaces
- [**breaking**] Replace Python backend with Bun + TypeScript scaffold
- _(scatter)_ Remove dead PiP branch; detach via FloatingScatterRoot only
- _(server)_ Collapse prepare.ts into state.ts
- _(scatter)_ UseQuery for category-column mapping
- _(axial)_ Drop ~820 lines of dead WebSocket/worker-pool/streams scaffolding
- Flatten src/axial/{core,conventions,store}/ → src/zarr/
- Collapse frontend/package.json → single root package.json
- Collapse frontend/ into src/frontend/, one vite.config + tsconfig
- Consolidate all wire-crossing Zod schemas into src/protocol/

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
