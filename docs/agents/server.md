# Server and data layer

Reference for `apps/ndea/src/server/`, `apps/ndea/src/cli/`, and `packages/zarr/`.
Paths are relative to `apps/ndea/src/` unless they name a package.

## Routes and transports

- `server/app.ts` builds one `Bun.serve` routes table (`appServeOptions`).
  Add an endpoint as an `api({ "/api/x/:id": { GET } })` entry: it gets CORS,
  a 204 preflight, and a 405 with `Allow`; unknown `/api/*` paths return 404
  `{ error: "Unknown API endpoint: …" }`. Routes live in `server/routes/*.ts`.
- `/` and every non-API path serve `apps/ndea/index.html`: through Bun's dev
  server with `--dev`, bundled on first request in a source run, embedded in
  the binary.
- `/data/query` is Mosaic's `restConnector` (`POST { type, sql }`; `arrow`
  returns Arrow IPC bytes, `exec` returns `{}`), with its own statement
  allowlist.
- `/ws` carries the framed `{ _id, _type }` protocol (`NdeaProtocol` in
  `@ndea/protocol`):
  - `workspace/watch`: each committed revision record.
  - `harness/watch`: `HarnessEvent`, i.e. the harness state (agents with last
    seen, mode, pending proposals, the 50-entry tool-call feed) on subscribe
    and on every change, plus one `rejected` event per invalid harness edit.
  - `session/watch`: the open collection; a tab reloads when it changes.
- `/ws/render`: remote rendering (below). `/mcp`: MCP (below).
- `GET /api/status` (the `RuntimeStatus` snapshot) and
  `GET /api/status/datasets/:name/structure` take the MCP bearer because they
  expose filesystem paths. Everything else is open under the local trust model;
  `--host` with a non-loopback address prints a warning and adds no auth.

## Workspace, history, actors

- `Workspace` (`server/workspace.ts`) owns the one revisioned document, its
  file, and its history. A missing file is written from the preset
  (`server/presets.ts`: a built-in under `apps/ndea/src/presets/`, default
  `exploration`, or a `.json` path).
- Writers (browser sync, `PATCH /api/workspace`, CLI, MCP) all call
  `workspace.patch` (or `restore`): RFC 6902 ops at a base revision,
  serialized, checked by `parseWorkspaceDocument` (structure, props, data
  references, bindings, unique ids), then by the injected `validate`
  (`workspaceIssues` in `server/routes/workspace.ts`: unknown set references
  and typed clauses naming columns the dataset lacks). Raw `data.sql` is
  checked only when it runs. Startup logs those issues for the file instead of
  refusing it; only a wrong format version refuses.
- The accepted document is deep-frozen; ops apply to a `structuredClone`.
- Each write appends a row (revision, base, actor, ops, document, time,
  `restoredFrom`) to `<workspace>.history.sqlite` in the same transaction as
  the atomic JSON write; watchers hear only committed revisions. Opening a
  workspace whose history lacks its revision adds a `system` baseline row.
- The actor comes from the transport, never the body: `browser`, `cli`
  (`X-Ndea-Client: cli`, sent by `cli/lib/server.ts`), or `mcp` with the agent
  from `X-Ndea-Agent`. Provenance, not authorization.
- History is server-side only (no revision UI): `GET /api/workspace/history`,
  `GET /api/workspace/revisions/:n`, `POST /api/workspace/restore` (revision N
  committed again as a new revision), `ndea workspace history|restore`, MCP
  `get_history`/`restore_revision`, and the TUI Activity tab.
- `workspaceResult` evaluates one element or source:
  `GET /api/workspace/elements/:id` and `GET /api/workspace/data/:name` return
  `{ revision, predicate, count }`, from `elementPredicate`/`dataSourceSql`
  (`frontend/core/workspace/data-sources.ts`), the functions the browser uses.
  SQL built from document values runs prepared through `server/observations.ts`.
- `GET /api/workspace` also returns the workspace `name` (file stem), used by
  view references `ndea://<name>/<element id>`.

## MCP and proposals

- `server/mcp.ts` serves MCP over Streamable HTTP (per-request
  `createMcpHandler`); tools close over the server session and the request's
  actor. Only loopback `Host`/`Origin` (localhost, 127.0.0.1, [::1],
  `*.localhost`) with the bearer pass.
- Every tool registers through `register`, which appends a `ToolCall` (args
  summary, the result's `outcome`) to the harness feed.
- Element ids in tools accept `ndea://<workspace>/<id>` (`resolveElementId` in
  `core/workspace/edits.ts`); another workspace's reference is rejected.
- `edit_dashboard` goes through `Workspace.harness` (`server/harness.ts`, in
  memory: survives collection switches, not restarts).
  - `propose` (default): validates the whole batch, applies its `set_filter`
    ops at once, holds the rest as a proposal of named ops (generated ids
    pinned, summaries from `describeEdit`), and returns
    `{ status: "proposed", id, changes }`. `get_proposal` reports outcomes.
  - Accept re-runs the chosen pending changes on the current revision and
    commits one patch stamped with the proposing agent; a change that no
    longer applies becomes `invalid` with its reason.
  - `patch_workspace` and `restore_revision` are refused in propose mode.
  - `direct` applies edits immediately.
  - REST (`server/routes/harness.ts`): `GET /api/harness`,
    `PUT /api/harness/mode`, `POST /api/proposals/:id/{accept,reject}`.
- Ops compile on a draft document and diff into one patch; add new agent
  operations to `core/workspace/edits.ts`.

## Observation sets

`server/observation-sets.ts` stores selections as content-addressed sets:
`POST /api/sets` (JSON rows or an octet-stream bitmask) persists
`~/.ndea/sets/<id>.json` and loads rows into the `ndea_obs_sets` temp table
that `{ op: "inSet" }` clauses query. DuckDB builds the set (sort, key file,
`COPY`); the id is sha256 of the sorted `dataset\0obs_name` keys. A saved
selection is a source `{ where: { op: "inSet", set } }`; writes referencing an
unknown set are rejected.

## Collections

- `collections:` in the project YAML (`cli/config.ts`; list or name-keyed
  map); datasets in none form an implicit collection named after the file. A
  run ingests one (`--collection`, default the first).
- `POST /api/collection { name }` clears every scope's `dataset` filter source
  (a `system` revision), builds the new session beside the old one
  (`cli/startup.ts`), swaps it in with `server.reload(appServeOptions(…))` on
  the same port, closes the old store, and pushes `session/watch`.
- One workspace file serves all collections. Metadata and `RuntimeStatus`
  carry `collection` and `collections` (`nObs` from store metadata, no ingest).
  MCP `list_collections` reports them.

## Data layer

- `server/zarr-extension.ts` `openDuckDB` is the only place DuckDB opens:
  unsigned extensions allowed, then `LOAD` of the duckdb-zarr build for the
  installed DuckDB (`.zarr-ext-cache/` in a checkout, extracted from the binary
  otherwise). `ndea self doctor` reports it.
- `server/zarr-ingest.ts` builds `obs_base`/`var_base` in SQL with `read_zarr`
  for a single store, a union (`UNION ALL BY NAME` + `_dataset`), and MuData
  (modalities via `group_path`, root obs/var from raw arrays, `<mod>:<col>` on
  collision, var tagged `_modality`). Row positions are `row_number() OVER ()`,
  asserted against each index array on every ingest.
- Gene columns: sparse `X`/layers through `read_zarr`; dense through
  `AnnData.readDenseColumn` (no filter pushdown upstream yet).
- Bool and nullable-int columns are BOOLEAN/INTEGER on every path.
  `read_zarr` renames a column named after its axis (`obs/obs`) and columns
  differing only in case; the catalog shows those names.
- `DatasetQuerySession` (`server/store.ts`) owns one connection and the
  `dataset` VIEW (obs_base + var + annotation joins); temp selections and
  Mosaic preaggregations share it. `columns()` is the catalog
  (`name → { sqlType, kind }`), refreshed on every VIEW rebuild.
- Annotation fields (`server/routes/annotations.ts`) are `label` or `text`,
  TEXT in `ann_*` tables joined into the VIEW (`kind: "annotation"`). Add,
  rename, convert, or drop only through `registerAnnotationColumn`,
  `renameAnnotationColumn`, `setAnnotationDtype`, `dropAnnotationColumn`.
  `writeAnnotationValues` takes `{ rowIndex, value }`. Every field write saves
  the Parquet sidecar before responding; `POST /api/annotations/commit
  [?dryRun=1]` writes fields into the AnnData `.obs` (`commitObsColumns`).
- Frontend schema mutations go through `/api/categorize` and `/api/var-column`.
- `@ndea/zarr` reads metadata only (`FrameMeta`, obsm shapes, dense matrix
  columns) through zarrita and `BunFileStore`, whose `getRange` supports
  `{ suffixLength }` for Zarr v3 shard indexes.

## Remote rendering

An image viewer with `render: "remote"` opens `/ws/render` (one session per
socket). `server/chrome.ts` lazily launches one headless Chrome (`NDEA_CHROME`,
platform paths, PATH, Playwright's `chromium-headless-shell`) over
`--remote-debugging-pipe`; each session is a tab at
`/render/image?element=…&session=…` rendering only that element's body
(`RenderFrame`, `RENDER_PAGE`). There `RenderPageBridge` encodes the canvas with
WebCodecs and applies the tile's actions; the tile's `RemoteViewerProvider`
decodes, mirrors viewer state into the same controls, and sends pointer/wheel
input that the server replays as CDP events. Caps: `NDEA_RENDER_SESSIONS`,
`NDEA_RENDER_MAX_PIXELS`, `NDEA_RENDER_FPS`, `NDEA_RENDER_BPP`.

## CLI and status TUI

- The Crust root action is `view` (`cli/index.ts`); a subcommand name wins over
  a same-named relative path.
- `ndea view` in a TTY shows the status screen (`cli/tui.ts`, OpenTUI, fed by
  `server/status.ts`): Overview, Activity, Logs; `--no-tui` or a non-TTY
  keeps log lines. `ndea status` renders it from `/api/status`. Per-dataset
  facts are built once in `ServerSession.status` (`cli/startup/session.ts`).
  `captureConsole` keeps 200 lines and mutes the terminal while the screen is
  up, so log through `console`. OpenTUI loads a native library on import:
  keep `cli/tui.ts` lazily imported and free of frontend imports.
