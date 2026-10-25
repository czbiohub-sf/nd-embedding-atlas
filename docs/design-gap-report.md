# Design gap report: ndea shell redesign

Step 0 of `design_handoff_ndea_shell/README.md`. The handoff's gap list (G1–G10) checked against
`refactor/agentic-oriented-design` at `3e2f64e`, plus the gaps that list misses (X1–X12).

**Approved 2026-10-24:** every recommendation under "Decisions needed" below. Item 7 follows the
prototype: the embedding chip sits in the tile header and in Settings › Data.

Status key: **exists**: already in the code; **extend**: partly there; **new**: nothing there yet.

## Summary

| #   | Item                                   | Status              | Changes the document schema?                 | Size  | Main risk                                           |
| --- | -------------------------------------- | ------------------- | -------------------------------------------- | ----- | --------------------------------------------------- |
| G1  | Tabs inside a tile                     | new                 | additive component (`tabs`); no format bump  | M     | layout editing is compiled out of production (X5)   |
| G2  | Named layouts                          | new                 | **yes**: `spec` becomes `layouts`, format v3 | M     | no migrations, so v2 files stop loading             |
| G3  | Collections                            | new                 | no (project YAML + server)                   | **L** | one `dataset` VIEW per server today                 |
| G4  | Axis picker (`xDim`/`yDim`)            | extend              | scatter config only                          | S     | `n_dims` is null until the embedding loads          |
| G5  | Table as the editor; delete `annotate` | extend + delete     | scatter-free; preset changes                 | L     | Save/Discard semantics; lost annotate features      |
| G6  | Proposals                              | new                 | no (server queue); new watch events          | L     | rebasing a queued edit onto newer revisions         |
| G7  | Selection into the filter link         | mostly exists       | no                                           | S     | modifier keys clash with today's gestures           |
| G8  | Link indicator + links popover         | new UI, data exists | no                                           | S     | no scope colors for `viewSync`/`ordering`           |
| G9  | Schema-driven view settings            | new                 | no (adds `.meta()` to config schemas)        | M     | plain JSON Schema cannot say "column" or "obsm key" |
| G10 | Copy reference                         | new                 | no                                           | XS    | the workspace has no name today                     |

## The current shell

- `WorkspaceShell.tsx`: dashboard, a 22px status bar (`nD`, table name, `LastChange`, `ws`), and a
  right-hand `HistoryPanel`.
- `DashboardPane.tsx`: renders `spec` through json-render. `Tile` draws a 26px header (grip · title ·
  `HeaderSocket` toolbar · `◆ id` · split · close), a 1px `--border`, and an 8px inner padding.
  `Slot` lists `+ <type>` buttons. `SplitButton` uses `glass`.
- `body-dock.tsx` + `ComponentRuntimeManager` (`core/component/runtime/workspace-runtime.ts`) keep one
  body per element and adopt it with `appendChild`. Only scatter and table use the header dock
  (`host.bodyHeaderElement`).
- `ThemeCommandPalette.tsx` binds ⌘K to a palette that holds only the light/dark commands.
- `components/ui/sonner.tsx` mounts a Toaster, but nothing calls `toast()`.
- `ThemeProvider.tsx` stores the theme in `localStorage`. That is a UI preference, not workspace state.
  The header comment says the default is dark; the code picks the OS setting, then light.
- There are no ⌘1–9 bindings.

## G1. Tabs inside a tile: new

**Today.** A tile is a view leaf of the `split`/`stack` tree. `slot` is the empty tile. The schema in
`dashboard.ts` is generic: `{ type, props, children: string[] }`. `children: "any"` already exists for
`stack`.

**Proposal.** Add a `tabs` entry to `BUILTIN_COMPONENTS` in `dashboard.ts`:

- `children: "any"`; every child must be a view element (a new rule in `dashboardIssues`);
- prop `active`, the id of one of its children (validated).

A bare view leaf stays valid and renders as a one-tab tile, so existing v2 files still parse and no
format bump is needed. The first **+** on a bare leaf wraps it in `tabs`; closing the last tab leaves
a `slot`.

**Edit ops** (`server/workspace-edits.ts`, pure operations in `dashboard.ts`):

- `add_tab {tile, type, props?, id?}`
- `move_tab {id, to, index?}`
- `close_tab {id}`
- `set_active_tab {tile, id}`
- `remove` of a tab element drops it from its `tabs` parent.

**Runtime.** `ComponentRuntimeManager` keys bodies by element id, so moving a tab between tiles keeps
its body. An inactive tab's body stays docked and detached. Activate it on first show (lazy) and keep
it afterwards (sticky, as today).

**Files**

- `frontend/core/workspace/{dashboard.ts,DashboardPane.tsx,workspace-store.ts,dashboard.test.ts}`
- `server/workspace-edits.ts`, `server/mcp.ts` (the `edit_dashboard` description)
- `frontend/core/component/runtime/workspace-runtime.ts`

**Open questions**

1. Should `active` be a document prop or session state? A document prop lets an agent choose the
   tab and matches `set_active_tab`, but every tab switch becomes a revision. **Recommend:** document
   prop.
2. Drag a tab to another tile: in phase 6 or later?

## G2. Several named layouts: new, schema change

**Today.** The document is `{ data, spec, state }` with format version 2 (`document.ts`), and only that
exact version loads.

**Options**

- **A.** Replace `spec` with `layouts: { [id]: { name, spec } }` plus `layout: <id>` (the active
  one). `data` and `state` stay shared. Element ids must be unique across all layouts, so
  `get_result {element}` and copy references (G10) stay unambiguous.
- **B.** One `elements` pool with `layouts: { [id]: { name, root } }`. A view could appear in two
  layouts and share its settings. This needs fewer bytes but invites confusion: editing a view in
  Review would change it in Exploration.

**Recommend:** A, with the active layout stored in the document. The README suggests session state,
but its own `set_active_layout` op is a document edit, and the harness should see what the person
sees.

**Breaking.** This is format v3. AGENTS.md says no migrations, so every existing `*.json` workspace
(including `~/.ndea/workspaces/*`) would be refused at startup. Choices:

- (a) refuse, and the user deletes the file to reseed from the preset;
- (b) a one-time `ndea workspace upgrade <file>` that wraps `spec` as layout `main`.

**Recommend:** (b) as a CLI command. It is an explicit tool, not a silent loader migration.

**Edit ops:** `add_layout {id?, name, from?}`, `rename_layout`, `remove_layout`, `set_active_layout`.
Every element op gains an implicit "in the active layout" or takes an explicit `layout`.

**Files**

- `frontend/core/workspace/{document.ts,dashboard.ts,workspace-store.ts,sync.ts,DashboardPane.tsx}`
- `server/{workspace.ts,workspace-edits.ts,mcp.ts,presets.ts,routes/workspace.ts}`
- `presets/*.json`, `core/workspace/data-sources.ts` (`elementPredicate` lookups),
  `component/runtime/workspace-runtime.ts`
- workspace docs, `CHANGELOG.md`, `AGENTS.md`

**Open question.** Do bodies of views in inactive layouts stop? **Recommend:** stop them on layout
switch, and keep only the visible layout's bodies alive.

## G3. Collections: new, highest risk

**Today**

- `config.ts` parses a flat `datasets[]` (`name`, `path`, `plate_path?`, `channels?`).
- All entries are opened at startup and ingested as one `UNION ALL BY NAME` with `_dataset`
  (`server/zarr-ingest.ts`). MuData unions are rejected.
- One `DatasetQuerySession` owns one `dataset` VIEW. Mosaic caches, observation sets
  (`dataset\0obs_name`), and scatter position caches all assume that one VIEW.
- Picking one dataset is already expressible as `{op:"eq", column:"_dataset", value}`.
- Clients learn `dataset_keys` from `/data/metadata.json` (`MetadataSchema`). There is no grouping
  field.

**Options**

- **A.** `collections:` in the YAML names member datasets. The server ingests **one** collection: the
  first, or `--collection <name>`. Switching collection restarts the session (re-ingest, new VIEW,
  page reload). This is simple and honest about cost.
- **B.** Ingest every collection into one union with a `_collection` column; a collection becomes a
  filter. Switching is instant, but cold start and RSS grow with the whole project, and schemas must
  union cleanly.
- **C.** Hot-swap the VIEW in-process (several `DatasetQuerySession`s). This touches every route,
  Mosaic's cache, sets, and the scatter caches. Large.

**Recommend:** A now; C only if switching becomes frequent. Datasets inside a collection stay a filter
on `_dataset`. Open question: which link does that filter live in? A `dataset` source key in each
filter scope, or a data source `where`?

**Files**

- `cli/startup/{config.ts,datasets.ts,session.ts}`, `server/zarr-ingest.ts`
- `server/routes/meta.ts` + `@ndea/protocol` `MetadataSchema` (a `collections` field)
- `server/mcp.ts` (`get_workspace` or `list_collections`)
- `docs/content/(data)/project-config.mdx`

The prototype's "Compare with batch 8" is not in the README; it is not planned.

## G4. Axis picker for n-dimensional obsm: extend

**Today**

- The scatter config (`packages/components/src/scatter/definition.ts`) is `obsmKey`,
  `colorByColumn`, `zDim`, `density.mode`.
- `ScatterToolbar.tsx` already has X/Y/(Z) dimension pickers, but `xDim`/`yDim` live in local state
  (`ScatterContent.tsx`); only `obsmKey`/`zDim` persist. Switching embedding resets them to 0/1.
- `/api/scatter-positions` already takes `x_col`/`y_col`/`z_col` (`<prefix>_<n>`, checked against the
  loader width), and the client's query key includes them. **No server change.**
- `n_dims` comes from `/data/metadata.json` and is `null` until the embedding loads.

**Change**

- Add `xDim`/`yDim` (int ≥ 0, defaults 0/1) to the scatter config and read them where local axis
  state lives now.
- Build the bottom-right picker `x UMAP1 ⌄ │ y UMAP2 ⌄ │ swap` from `@ndea/ui` select; the wheel over
  x or y steps the dimension.
- Labels come from the obsm key (`X_umap` → `UMAP1…n`, `X_pca` → `PC1…`).
- Remove the toolbar pickers.

**Also on the scatter, not in G4**

- Point size has no config prop today (`pointRadius` comes from a services store). Add `pointSize`.
- The legend pin is a new prop, `legend: "popover" | "pinned"`.

Both are additions to the component config, not to the document schema.

**Open question.** The prototype puts an **embedding picker chip** ("UMAP · dinov2-s14") in the tile
header and in Settings › Data, while the README says the header holds nothing else. Embedding
parameters and author ("n_neighbors 15 · You") don't exist in our data. **Recommend:** keep obsm
selection in Settings › Data only, showing key and dims.

**Files:** `scatter/{definition.ts,contracts.ts,ScatterContent.tsx,ScatterToolbar.tsx,ScatterView.tsx,helpers.ts}`.

## G5. Table as the annotation surface: extend, then delete `annotate`

**Table today** (`packages/components/src/table/`)

- TanStack Table + Virtual over server-side DuckDB paging (`useTableQuery`).
- Config `{ columns: string[] | null }` is reserved and unused; columns come from
  `metadata.obs_columns`.
- Header click sorts (shared `ordering`), a Columns popover toggles visibility, and a row click sets
  focus.
- No search, filter, group, multi-select, or editing.

**Annotate today** (`packages/components/src/annotate/`)

- Label mode: hotkeys stamp the focused or selected rows.
- Range mode: `{metric}_min/_max` brackets, and "apply to scope".
- `CommitPanel` writes to `.obs` with a dry run.

**Server** (`server/routes/annotate.ts`)

| Endpoint                                  | Does                                                           |
| ----------------------------------------- | -------------------------------------------------------------- |
| `GET`/`POST /api/annotations/columns`     | list / add a field (categorical, string, integer, float)       |
| `DELETE /api/annotations/columns/:name`   | delete a field                                                 |
| `POST /api/annotations/values`            | set values, by explicit rows or by predicate                   |
| `POST /api/annotations/save`              | Parquet sidecar checkpoint (autosave runs 2s after each write) |
| `POST /api/annotations/commit[?dryRun=1]` | write fields into `.obs` via `commitObsColumns`                |

Annotation columns are `ann_*` tables LEFT JOINed into the VIEW, and the catalog marks them
`kind: "annotation"`.

**Missing**

1. **Rename** and **convert** a field. Add `DatasetQuerySession` methods that rebuild the VIEW (per
   AGENTS.md), plus routes.
2. **Discard.** Today every edit hits the server at once. **Recommend:** keep unsaved edits in a
   client buffer (that is the README's "client's unsaved set"). Save posts them through
   `/api/annotations/values`; Discard drops the buffer.
3. **Provenance.** The catalog `kind` already separates obs / var / annotation; "unsaved" is the
   client buffer. Var/gene columns: show them with the obs marker, or hide them from the table?
4. **Multi-select into the filter link.** Shift and ⌘ selection becomes a bitmask, then
   `POST /api/sets`, then `{op:"inSet"}` under the table's own source key. This reuses the scatter
   path.
5. **Toolbar:** search, `Filter │ Sort │ Group │ Fields`.
   - Filter writes typed clauses under the table's source key.
   - Sort uses `ordering`.
   - Fields is the existing Columns popover.
   - **Group** over server-paged rows is non-trivial (a `GROUP BY` page query plus expandable
     groups). **Recommend:** ship group-by-one-column with collapsed counts, or defer it.

**Deliberately lost with `annotate`:** label hotkeys (the README says no table shortcuts) and range
mode. "Apply to scope" survives as select-all (header checkbox) followed by a predicate write.

**Open question.** Where does "write into `.obs`" (commit) go? **Recommend:** a table command
"Write fields to file…" that keeps the dry-run confirmation.

**Delete / update**

- Delete `packages/components/src/annotate/`.
- `catalog.ts`: drop the `annotate` entry and its services.
- `frontend/core/component/definitions.ts`, `runtime/host.ts`: drop the annotate services.
- `presets/annotate.json`: rename the preset? (It is the default preset name in `server/presets.ts`,
  `cli/commands/view.ts`, README and docs.)
- `server/__tests__/presets.test.ts`, `CHANGELOG.md`, `docs/content/(contribute)/cli.mdx`

## G6. Proposals: new

**Today.** `edit_dashboard` and `patch_workspace` commit at once through `Workspace.patch`.
`workspace/watch` pushes only committed revisions (`WorkspaceChange`). An MCP write the workspace
rejects is returned to the agent only; the browser never hears of it.

**Proposal**

- A pending queue on `Workspace` (`server/workspace.ts`), outside the document. Each entry holds:
  - id, actor, and the **named `DashboardEdit` ops** (not RFC 6902), so accepting re-runs them against
    the current revision;
  - an element-level summary for display.
- `workspace/watch` gains event kinds: `proposal`, `resolved`, `rejected` (with issues, for the
  one-time shake).
- Accept (one change or all) commits through `workspace.patch` with the harness as actor. Reject drops
  the entry. An entry that no longer applies is shown as invalid with its reason.
- Mode `propose | direct` is a server session setting changed from the Harness flyout; the default is
  `propose`.
- MCP:
  - In propose mode `edit_dashboard` returns `{ status: "proposed", id }`.
  - New `list_proposals` (or the status of one id) lets the agent see the outcome.
  - `patch_workspace` in propose mode: reject it (it pins a revision), or queue it at its base.
    **Recommend:** reject, with a hint to use `edit_dashboard`.
- The browser previews a proposal (ghost tile, source diff) by applying its ops to a copy of the
  document.

**Prerequisite decision.** `applyDashboardEdits` lives in `server/workspace-edits.ts`, but it is
pure; it imports only frontend modules and the protocol. Ghost previews, and a UI that edits through
the same op vocabulary (G1 tabs, G8 unlink, G9 set_props), need it in the browser. **Recommend:**
move it to `frontend/core/workspace/edits.ts`, and let `WorkspaceStore` commit edits through it.
Update the AGENTS.md rule to "new agent operations go in `core/workspace/edits.ts`". There would
still be one write path.

**Open questions**

1. Do `set_filter` ops from the harness also wait for acceptance, or apply directly?
2. Persist the queue across restarts (a SQLite table next to revisions), or keep it in memory?
   **Recommend:** memory; a restart drops pending proposals.

**Files**

- `server/{workspace.ts,workspace-edits.ts,mcp.ts,ws.ts,routes/workspace.ts}`
- `@ndea/protocol` `workspace.ts` (events)
- `frontend/core/workspace/{sync.ts,workspace-store.ts,DashboardPane.tsx}`
- `history.ts` `compareDocuments`: keep it for proposal summaries when the History panel goes (X6).

## G7. Lasso selection into the filter link: mostly exists

**Already true**

- The GPU lasso/marquee bitmask goes to `POST /api/sets?rows=n` (octet-stream).
- `{op:"inSet", set}` is published on facet `lasso` under the element id in its filter scope
  (`useScatterBrushSync.ts`, `coordination/filter-binding.ts`).
- Esc or a background click clears it; unmount clears the facet. Linked views narrow today.

**Missing**

- **Selection pill:** `1,284 obs · lasso`, with Invert / Save as source / Clear.
  - The count is the `count` in the `POST /api/sets` response (exact, server-side), not
    `get_result`. `get_result` would count the element's whole predicate, not the selection.
  - **Invert:** `{op:"not", clause:{op:"inSet"}}` (`not` exists in `FilterClauseSchema`).
  - **Save as source:** `set_data {name, source:{where:{op:"inSet", set}}}`.
- **Shift adds, ⌥ subtracts.** Today Shift-drag means rectangle and Shift+⌥-drag means lasso. With
  explicit V/B/L tools those modifiers are free; the GPU selection needs union and difference
  against the previous mask.
- **V / B / L shortcuts.** They go to the hovered or selected tile and are ignored inside inputs.

**Files:** `scatter/{ScatterView.tsx,ScatterToolbar.tsx,gpu/hooks/useScatterInteraction.ts,gpu/hooks/useScatterBrushSync.ts}`, plus the GPU lasso combine step.

## G8. Link indicator and links popover: new UI, data exists

**Data.** `$bindState` props, `elementScope()`, `bind`/`unbind` ops, `COORDINATION_TYPES` (focus,
filter, colorBy, viewSync, ordering), and `WorkspaceStore.coordination` all exist.

**New**

- Header indicator: an icon plus one dot per bound scope.
- Popover: one row per scope with its value (a filter summary, the focused obs name, the color-by
  column), member views (titles), and Unlink.
- Hovering a row highlights member tiles; that is session state (`WorkspaceSession`).
- "Manage all scopes" opens the Links flyout.

**Gaps**

- `--scope-*` defines filter, focus, and color only. `viewSync` and `ordering` need colors (or no
  dot).
- Scope names are free strings (`A`); the prototype shows `F1` / `FOCUS` / `COLOR`. Display
  `<type> <scope>` as is, without renaming.
- Unlink in the browser must also drop the element's own filter clauses, as the server `unbind` does.
  The G6 prerequisite (shared edits) covers this.

**Files:** `DashboardPane.tsx` (header), a new `LinksPopover.tsx`, `workspace/types.ts` (hover
session field), `workspace-store.ts`.

## G9. View settings popover: new

**Today.** Each definition has a Zod config schema. `list_components` already sends its JSON Schema
(`z.toJSONSchema`). There is no settings UI; config changes come from in-body controls through
`patchConfig`.

**Change**

- A `ViewSettings` popover: editable title, then Display / Data / Links tabs. The footer has copy
  reference, fullscreen, duplicate, and Remove (prototype).
- Controls are generated from the schema: boolean → switch, enum of 2–3 → segmented, larger enum →
  select.
- Plain JSON Schema can't say that a string is a column or an obsm key, or that a prop already sits
  on the view (point size, color-by, axes) and must be hidden. **Recommend:** Zod `.meta({ section,
  control, hidden })` on config fields, read by the generator.
- Data tab: `data` source select, plus component data props (obsm key).
- Links tab: one switch per type in `binds` (bind/unbind).
- Writes go through `set_props` (`WorkspaceStore.setElementProps`).
- **Missing in `@ndea/ui`:** a Switch component. Add it on Base UI `Switch`.

**Files**

- every `packages/components/src/*/definition.ts` (meta)
- `@ndea/sdk` (meta type, if needed)
- a new `frontend/core/workspace/ViewSettings.tsx`
- `packages/ui/src/components/switch.tsx`

## G10. Copy reference: new, small

**Today.** The workspace has no id or name; one server serves one workspace file.
`get_result {element}` takes a bare element id. The prototype copies `ndea://<ws>/<ds>/<what>`.

**Recommend**

- Copy `ndea://<workspace-file-stem>/<element-id>`. The stem comes from the snapshot; add `name` to
  `WorkspaceSnapshotSchema`.
- `get_result` (and `edit_dashboard` ids) accept either a bare id or such a reference. The tool parses
  it and rejects a stem that names a different workspace.
- A toast confirms the copy.

**Files:** `@ndea/protocol` `workspace.ts`, `server/{workspace.ts,mcp.ts,routes/workspace.ts}`,
`DashboardPane.tsx`.

## Gaps the list misses

| #   | Gap                              | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Phase                         |
| --- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| X1  | Harness flyout + green dot       | `server/status.ts` tracks `agents` (last seen) and `mcpInFlight`, but only behind the bearer-protected `/api/status`. MCP is stateless HTTP, so "connected" can only mean "an MCP request in the last N minutes". There is no tool-call log. **Recommend:** push agent presence + a bounded tool-call feed (name, summary, outcome) over `/ws`, under the local trust model (agent names carry no paths).                                                                       | 1 (dot), 7 (feed)             |
| X2  | Header embedding chip            | See G4.                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | 2                             |
| X3  | Image viewer                     | `ChannelControls.tsx` has visibility, an HTML color input, contrast inputs, and a two-thumb `Slider`. **No histogram UI** (bins already come in the channel-stats response). **No scale bar** (needs pixel size from OME-Zarr `coordinateTransformations`). The focus box uses `--destructive` (`useBboxLayer.ts`), but should use `--focus-mark`. The colormap uses a native color input; the design uses a colormap dropdown.                                                 | 3 (not in the README's order) |
| X4  | Crop gallery                     | The focused crop has `border-primary ring-2 ring-primary/30`; the design wants a 2px `--primary` outline.                                                                                                                                                                                                                                                                                                                                                                       | 1                             |
| X5  | **Layout editing in production** | `LAYOUT_EDITING_ENABLED` compiles split, swap, remove, and fill out of production builds. The design's +tab, empty-tile picker, Remove, and duplicate are everyday actions. **Recommend:** lift the gate in phase 1 and update AGENTS.md.                                                                                                                                                                                                                                       | 1                             |
| X6  | **Revision UI removal**          | The README removes the History panel and status bar. That deletes `HistoryPanel.tsx`, `LastChange`, `StatusBar`, and the `WorkspaceHistory` read model added in `2fa25e8` (keep `compareDocuments` for G6). Server history, `GET /api/workspace/history`, `restore`, CLI `ndea workspace history/restore`, MCP `get_history`/`restore_revision`, and the TUI Activity tab stay.                                                                                                 | 1                             |
| X7  | Theme                            | The design makes dark the default; the code picks OS, then light. The theme commands move from the ⌘K palette to Settings and `>` commands. The font-set and motion tweaks are optional (the README says ship the default first).                                                                                                                                                                                                                                               | 1                             |
| X8  | Fonts and icons                  | `tokens/fonts.css` imports Google Fonts and the DS uses the Lucide CDN. Both break offline and on HPC, and neither embeds in the binary. Self-host Geist (`@fontsource-variable/geist` next to the existing `geist-mono`) and use the installed `lucide-react`. Port the 11 `nd-*` icons as inline SVG components.                                                                                                                                                              | 1                             |
| X9  | Native `<select>`                | `charts/core/field-picker.tsx`, `charts/vgplot/body.ts` (built imperatively), and the global select styles in `app.css` (lines 281–312).                                                                                                                                                                                                                                                                                                                                        | 1                             |
| X10 | Glass                            | `@utility glass` (`packages/ui/src/styles.css`), used in `@ndea/ui` context-menu, dropdown-menu, hover-tip, panel, select, and tooltip; in `DashboardPane.tsx` (split popover); in image-viewer `ChannelControls`/`ViewerControls`/`VolumeControls`; and in scatter `CategoricalLegend`/`ContinuousLegend`. Delete the utility and the `Panel` glass variant. Note: dark `--overlay` is `rgba(16,16,16,.92)`, slightly translucent but unblurred, which is what the token says. | 1                             |
| X11 | Header toolbar socket            | The header holds only fixed chrome, so the `headerDock`/`HeaderSocket` and SDK `ComponentHost.bodyHeaderElement` go away. Scatter controls float in the body; the table's Columns popover moves into its toolbar. This changes the SDK contract (`packages/sdk/src/host.ts`).                                                                                                                                                                                                   | 1–2                           |
| X12 | Tooltips and toasts              | `HoverTip` waits 700ms and the provider 0ms; the design wants 500ms, instant between neighbours (one `TooltipProvider` delay group). Sonner needs a restyle (356px, title + description, about 4s); copy reference, Save, and proposal outcomes will call it.                                                                                                                                                                                                                   | 1                             |

Notes:

- `screenshots/03-view-settings.png` shows ⌘K drawn over the settings popover; the prototype is the
  reference for settings.
- The prototype rail has an extra Collections button that the README's rail list omits. **Recommend:**
  fold collections into the Data flyout, as the README says.

## Decisions needed before the schema phases

1. **G1:** `active` tab in the document (recommended) or in session state.
2. **G2:** option A (`layouts` of full specs, unique element ids, active layout in the document) and
   **v2 → v3 handling** (recommended: an explicit `ndea workspace upgrade`).
3. **G3:** one collection per server run (recommended) versus everything ingested.
4. **G6:**
   - move the pure edit ops to `core/workspace/edits.ts` and update the AGENTS.md rule (recommended);
   - the queue is in-memory;
   - whether `set_filter` needs acceptance;
   - `patch_workspace` is rejected in propose mode.
5. **G5:**
   - client-side unsaved buffer (recommended);
   - Group: defer or ship one level;
   - where commit-to-`.obs` lives;
   - whether to rename the `annotate` preset.
6. **X5:** lift the production gate on layout editing (recommended).
7. **G4 / X2:** embedding picker in Settings › Data only (recommended) or also as a header chip.

## Phase mapping

1. Tokens + shell frame: tokens, Geist, rail + flyouts, tile chrome; X4–X12, minus X11's scatter part.
2. Embedding controls: G7, G4, point size, legend popover + pin, X11 (scatter).
3. Links + settings + reference: G8, G9 (+ `switch`), G10, X3.
4. Table as the editor: G5; delete `annotate`.
5. ⌘K switcher (one layout until G2).
6. G1, G2, G3, as approved.
7. G6 (+ X1 feed).
