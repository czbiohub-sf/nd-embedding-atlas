# nd-embedding-atlas (ndea)

A browser dashboard that links AI embeddings to the 5D (TCZYX) images behind
them. One server process ingests AnnData/MuData through DuckDB, serves the
React frontend, and exposes the same workspace to people (the browser) and to
harnesses (coding agents over MCP). Everything on screen is one **workspace
document**; every change by anyone is an edit to it.

## Tooling

- `vp` (Vite+) is the only command you type: install, tasks, checks, tests,
  builds, the dev server. Bun runs underneath (runtime, bundler, test runner,
  compiler); package scripts may call Bun, you don't. No Node, npm, pnpm,
  Yarn, or Python (one-off binaries: `bun x --bun <tool>`).
- Project tasks run as `vp run <task>`. Bare `vp build` / `vp dev` / `vp test`
  are Vite+ built-ins and do the wrong thing (`vp build` is Rolldown, not the
  single-binary pipeline).
- Config APIs come from `vite-plus`, test APIs from `bun:test`. TypeScript 7,
  strict.
- Dependencies: shared versions are `catalog` entries in the root
  `package.json` (edit once, then `vp install`); workspace changes use
  `vp add|remove --filter <workspace> <pkg>`; root-only tooling updates name
  their packages (`vp update <pkg…>`) so Bun keeps `catalog:` references.

```bash
vp run verify                 # check + test every workspace (cached); the gate before any commit
vp run dev [--fixture]        # one Bun process with HMR; infectomics beside the repo, or synthetic data
vp run ndea <args>            # the CLI from source, e.g. `vp run ndea view <project.yaml>`
vp run build                  # dist/ndea, the single-file binary
vp run audit:gate             # fallow audit: fails on dead code, boundary, dupes, complexity this change adds (CI runs it)
vp run mutation [paths…]      # fallow mutation over changed code (or the paths): which mutants the tests miss
```

Other tasks (`build:zarr-ext`, `bytecode-order`, `audit` (the full Fallow
report), `bench:ingest`, `release:version`, `docs*`) are in `vite.config.ts`
`run.tasks` (cached) and the root `package.json` scripts.

## Layout

```text
apps/ndea/            CLI (Crust), server (Bun.serve), frontend (React 19), binary build
packages/components/  built-in view components and their bodies
packages/sdk/         component authoring + host contract
packages/protocol/    shared Zod request/response schemas
packages/ui/          design tokens and shadcn/Base UI controls
packages/ochre/       color, colormaps, TypeGPU helpers
packages/zarr/        AnnData/MuData/OME-Zarr metadata and writes
docs/                 Waku docs site (own lockfile); docs/agents/ holds agent references
design_handoff_ndea_shell/  the UI design handoff: tokens, reference JSX, prototype
```

Dependencies flow one way: `apps/ndea → every @ndea/*`;
`@ndea/components → sdk, protocol, ochre, ui`; `sdk → protocol`;
`ui → ochre`. Packages import only public `@ndea/*` entrypoints and never app
code. Inside the app, the server imports `src/env/` (state and cache dirs,
install layout, version), the pure workspace model
(`core/workspace/{types,document,dashboard,edits,data-sources}.ts`,
`core/coordination/types.ts`), and `@ndea/components/filter`, never the CLI or
React code. `.fallowrc.json` `boundaries` enforces all of this, plus no
`localStorage` in `core/workspace` and no `process.exit` outside the CLI's two
sanctioned exits; extend its zones when you add an area.

## The workspace document

The spine of the app. Know these before changing anything that reads or
writes UI state:

- **Shape (format v3, exact version only):** `{ data, layouts, layout, state }`.
  `data` = named sources (`from`, typed `where`, `sql`); `layouts` =
  `{ [id]: { name, spec } }`, each spec a flat `{ root, elements }` tree;
  `layout` = the active layout id; `state` = coordination cells shared by
  every layout.
  Element ids are unique across all layouts. `core/workspace/document.ts`
  validates it, pure, so server and browser run the same rules. Another format
  version is refused at startup; deleting the file reseeds it from the preset.
- **One write path.** The server's `Workspace.patch` (RFC 6902 at a base
  revision, validated, committed with history and an actor) is the only way a
  document changes; the browser commits locally through `WorkspaceStore.commit`
  and `WorkspaceSync` PATCHes the diff. Workspace state lives only there:
  editor-only state goes in `WorkspaceSession`, never `localStorage`.
- **Named edit ops** (`core/workspace/edits.ts`): `add`, `set_props`, `remove`,
  `split`, `swap`, `bind`/`unbind`, `set_filter`, `set_data`, tabs, layouts.
  MCP `edit_dashboard` and `WorkspaceStore.apply` run the same ops, and every
  browser edit is one; a new operation is a new op here, never a new write path.
- **Proposals:** harness edits arrive as proposals by default (Settings ›
  Harness edits): `server/harness.ts` holds them in memory and accept re-runs
  the ops on the current revision as one patch stamped with the agent.
- **Coordination is document data:** a prop `{ $bindState: "/<type>/<scope>" }`
  joins `state[type][scope]` (focus, filter, colorBy, viewSync, ordering). A
  filter scope is a crossfilter `source → facet → FilterClause`: members see
  every source's clauses but their own. Publishers emit typed clauses, never
  SQL.
- **Components:** a view is an `@ndea/sdk` `ComponentDefinition` registered in
  `packages/components/src/catalog.ts`; its element props are its config. Config
  fields carry `.meta({ title, section, control, hidden })`, which builds the
  view settings popover. The body gets one `ComponentHost` with every service.

## Load-bearing constraints

- **Column names:** resolve every request- or document-supplied column against
  `DatasetQuerySession.columns()` and interpolate it with `quoteIdent`
  (`@ndea/protocol`, the one copy). The browser lists columns only from that
  catalog (`GET /api/columns`, `useColumns` in `@ndea/components/query`).
- **The `dataset` VIEW:** add or change columns only through
  `DatasetQuerySession` methods (`addObsIndexColumn`, `register*Column`,
  annotation field methods); they rebuild the VIEW and its catalog. A bare
  `ALTER TABLE obs_base` breaks the VIEW.
- **Rows from JS** go through `server/append-columns.ts` (`DuckDBDataChunk`s).
- **Mosaic:** its cache keys on raw SQL, so predicates over mutable temp tables
  carry a revision suffix; `/data/query`'s allowlist keeps Mosaic's
  `CREATE/DROP SCHEMA`, `CREATE TABLE`, `DROP TABLE IF EXISTS`.
- **Categoricals are VARCHAR:** `ENUM` breaks nanoarrow's Arrow IPC with a
  fatal error that invalidates the database.
- **Embedding scene order:** the scatter stores points in Morton order
  internally; every seam (setters, selection bitmask, picks) speaks row order.
- **Frontend flag:** branch on `process.env.NODE_ENV` only; `import.meta.env`
  does not exist.
- **Workers:** `new URL("./worker.ts", import.meta.url)`, which works in dev
  and in the compiled binary.
- **Trust model:** local trust. The server binds 127.0.0.1; `/mcp` adds a
  loopback Host/Origin check and the bearer in `~/.ndea/mcp-token`; everything
  else is open by design.

## Code rules

- `import type` for types; double quotes, semicolons, trailing commas (Oxfmt).
- `@/` = `apps/ndea/src/frontend/`. Modules kebab-case, React components
  PascalCase, hooks `useX`.
- Vocabulary from `design_handoff_ndea_shell/docs/glossary.md` in UI copy,
  comments, and MCP descriptions: workspace, layout, tile, tab, view,
  component (never "node"), empty tile (`slot` in code), link (`scope` in
  code), source, collection, dataset, harness. Every count says "obs".
- UI builds on `@ndea/ui` and the design tokens; pop-ups use the shared
  `popoverFrame`. The design handoff marks some things removed on purpose
  (revision UI, chat, glass/blur, native `<select>`, ⌘1–9 shortcuts); they
  stay out.
- CLI commands fail by throwing; `cli/lib/style.ts` renders each failure once
  and owns all terminal styling. `process.exit` belongs to server shutdown and
  the startup interrupt only. Commands that talk to a running server use the
  `server` context (`--host`/`--port`, `NDEA_HOST`/`NDEA_PORT`).
- Clean breaks: when something is superseded, migrate every caller and delete
  the old path.

## Verifying a change

`vp run verify` must be green. For anything the browser shows, also run it:
`vp run ndea view <project.yaml> --port <free port> --workspace /tmp/<x>.json`
(a temp workspace keeps `~/.ndea/workspaces` untouched; the default test data
is `../ome-atlas-test-data/infectomics/infectomics.yaml`, 70,121 obs), and for
build or server changes the binary (`vp run build`, then `./dist/ndea view …`).
Delete observation sets you create under `~/.ndea/sets`.

## References

Read the matching file before working in that area:

- `docs/agents/server.md`: server routes, `/ws` methods, workspace history and
  actors, MCP and proposals, observation sets, collections, ingest and the data
  layer, remote rendering, the status TUI.
- `docs/agents/frontend.md`: shell and flyouts, tiles and tabs, the runtime
  manager, embedding/table/image-viewer internals, proposals UI, ⌘K, design
  tokens.
- `docs/agents/build.md`: the binary, static `duckdb.node`, the duckdb-zarr
  extension, DuckDB upgrades, dev server and HMR, updates, Windows.
