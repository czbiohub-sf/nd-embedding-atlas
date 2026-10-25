# Design phase log: ndea shell redesign

One section per phase of `design_handoff_ndea_shell/README.md` "Recommended build order",
following the approved decisions in `docs/design-gap-report.md`. Each section lists what changed,
the files, what was deferred, and what still differs from the screenshots and the prototype.

## Phase 1: tokens and shell frame (`2db7624`)

**Changed**

- Design tokens in `@ndea/ui` (`tokens.css`, mapped in `styles.css`): Pierre Dark neutrals, Biohub
  teal accent, Geist + Geist Mono, the 3.5–9.8px radius scale, elevation, 140/180/260ms motion.
  Dark is the default.
- One frame for every pop-up, 500ms tooltips, restyled toasts. No glass, no native `<select>`.
- Shell: a 32px rail with hover/pinned flyouts (Layouts, Data, Links, Harness, Settings), harness
  presence over `/ws` `harness/watch`.
- Tiles: 4px gutters, a 30px header, right-click split/remove, an empty-tile component list.
  Layout editing ships in production.
- Removed: the status bar, the History panel, `WorkspaceHistory`, and the header toolbar socket
  (`ComponentHost.bodyHeaderElement`).

**Files:** `packages/ui/src/{tokens.css,styles.css,components/*}`, `apps/ndea/src/frontend/{app.css,App.tsx,ThemeProvider.tsx}`,
`core/shell/*`, `core/workspace/{DashboardPane,WorkspaceShell,compare,sync}.ts(x)`,
`server/{status,ws}.ts`, `packages/protocol/src/{index,status}.ts`, `packages/sdk/src/host.ts`.

**Deferred:** none outside later phases.

**Remaining differences:**

- Toasts use Sonner's slide-in, not the exact `nd-toast` curve, and have no dismiss button.
- Flyouts use the design-system card fill; the prototype uses the tile fill with a ring.
- Pinning a flyout is not animated.

## Phase 2: embedding controls

**Changed**

- Embedding view (`scatter`, now titled "Embedding") rebuilt around a floating control group, top
  left: Pointer / Box / Lasso (V, B, L; shift adds, ⌥ subtracts), then Legend, Point size, and Axes
  popovers.
  - Legend popover: color by (with the var search and modality picker), palette and colormap,
    density mode (mean | dominant | weave), and the legend with a Pin toggle. A pinned legend
    sits bottom-left with no close button.
  - Point size popover: the size slider and the trajectories toggle.
  - Axes popover: a single 2D | 3D toggle, Z dimension, perspective/orthographic, selection
    depth (through | front), and Fit view.
- Axis picker, bottom-right and always shown: `x PHATE1 ⌄ │ y PHATE2 ⌄ │ swap`. The wheel over an
  axis steps its dimension (G4).
- Selection (G7): shapes combine CPU-side with the current bitmask, then go to `POST /api/sets`
  and are published as `{op:"inSet"}` on the view's own filter facet.
  - A pill at the top centre shows `47,353 obs · box` (the exact count from the server) with
    Invert (flips the bitmask), Save as source (`data["Selection-<n>"]`, via the new host
    `dataAPI.saveSource` → `WorkspaceStore.setDataSource`), and Clear (or Esc).
- Config gains `xDim`, `yDim`, `pointSize`, `legend` (popover | pinned). The body persists its own
  changes without restarting.
- The tile header shows the embedding chip (`EmbeddingChip.tsx`): a filterable list of obsm keys
  with their dimension counts and the views using each. A switch writes `{obsmKey, xDim: 0,
  yDim: 1, zDim: null}`.
- Deleted: the docked toolbar (`ScatterToolbar.tsx`), `scatter-ui-store.ts`,
  `mudata/EmbeddingPicker.tsx`, `useScatterBrushSync.ts`, `point-radius-store.ts`,
  `bracket-icon.tsx`.

**Files:** `packages/components/src/scatter/{ScatterControls,ScatterView,ScatterContent,CategoricalLegend,ContinuousLegend,ColorSourcePicker,definition,contracts,helpers,selection-bits,view}.ts(x)`,
`scatter/gpu/{gpu/orchestrator,hooks/useScatterSelection,hooks/useScatterInteraction,components/ScatterGpuHost}.ts(x)`,
`packages/sdk/src/host.ts`, `apps/ndea/src/frontend/core/component/runtime/{host,workspace-runtime}.ts`,
`core/workspace/{workspace-store,DashboardPane,EmbeddingChip}.ts(x)`.

**Checked:** `vp run verify` green (17/17). `vp run build`. Binary smoke on infectomics: box
select gave 47,353 obs and narrowed the linked table and gallery; Clear emptied the filter cell;
the Legend and Axes popovers rendered.

**Deferred**

- While dragging with shift or ⌥, only the shape being drawn is highlighted; the combined
  selection appears on release (`ponytail:` in `orchestrator.ts`).
- Esc clears selection and focus in every embedding view, not just the hovered one.

**Remaining differences**

- Source names are `Selection-2`, not "Selection 2" (data source names allow no spaces).
- Embedding entries show the obsm key and dimension count; the prototype's method parameters
  and author ("n_neighbors 15 · You") have no source in our data.
- The point-size icon is Lucide `circle-dot`, not the prototype's dots glyph.

## Phase 3: links, view settings, copy reference, image viewer

**Changed**

- Shared edits (G6 prerequisite): `server/workspace-edits.ts` moved to `core/workspace/edits.ts`.
  `WorkspaceStore.apply(edits)` commits named ops through the one write path, and remove /
  source writes use it. AGENTS.md now says agent operations go there.
- Link indicator and popover (G8, `LinksPopover.tsx`): one dot per link coloured by
  `--scope-*`. Rows show the type, the link name, its value, member views and Unlink. Hovering
  highlights member tiles (`WorkspaceSession.highlightedElementIds`). "Manage all scopes" pins
  the Links flyout, which shares the same rows.
- View settings (G9, `ViewSettings.tsx`, `config-fields.ts`): an editable title, then Display /
  Data / Links tabs generated from each component's config schema through Zod
  `.meta({ title, section, control, hidden })`. The footer holds copy reference, fullscreen,
  duplicate and remove. `@ndea/ui` `Switch`.
- Copy reference (G10, `reference.ts`): `ndea://<workspace name>/<element id>`. MCP accepts it
  wherever it takes an element id and rejects another workspace's reference.
  `GET /api/workspace` returns `name`.
- Image viewer (X3):
  - Channels panel: visibility, named colormaps, contrast over the log histogram, auto
    contrast; it opens below the button on tiles under 300px.
  - View panel: T/Z, 2D/3D, focus box, volume, local/remote render.
  - A scale bar (1/2/5 × 10ⁿ in the OME-Zarr axis unit). `VolumeControls.tsx` is deleted.

**Files:** `apps/ndea/src/frontend/core/workspace/{edits,edits.test,LinksPopover,ViewSettings,config-fields,config-fields.test,reference,workspace-store,DashboardPane,types,workspace-context}.ts(x)`,
`core/shell/{Shell,flyouts}.tsx`, `server/{mcp,workspace}.ts`, `packages/protocol/src/workspace.ts`,
`packages/ui/src/components/switch.tsx`, `packages/sdk/src/component.ts`, every
`packages/components/src/*/definition.ts`,
`packages/components/src/image-viewer/{CropViewer,body}.tsx` and
`viewer/{ChannelControls,ViewerControls,ViewerContext,ViewerProvider,RemoteViewerProvider,useFovLoader,scale-bar}.ts(x)`.

**Checked:** `vp run verify` green (17/17). `vp run build`. Binary smoke on infectomics: the header
shows the link dots, gear, copy and fullscreen; the links popover listed Focus A (obs 66,262) and
Filter A with members; the settings popover showed its tabs and footer; the Channels panel
showed 3 channels with histograms and colormaps; the scale bar read 10–20 µm; the focus box is
gold.

**Deferred**

- The table `columns` and gallery `lanes` config fields are hidden (no body reads them).
  Phase 4's Fields menu takes over `columns`.
- Contrast slider: dragging the limits inward from outside the data range shrinks the range
  once mid-drag.

**Remaining differences**

- The prototype's settings Display tab for an embedding shows "Focus marker"; our embedding has
  no such prop, so its Display tab says the controls sit on the view.
- The link indicator uses `NdScopesIcon` (as `data/ScopeIndicator.jsx`), not Lucide `git-fork`.

## Phase 4: table as the editor; annotate removed

**Changed**

- The table is an Airtable-lite field editor (G5).
  - Toolbar: server-side search across text fields, then `Filter │ Sort │ Group │ Fields`,
    Save / Discard (with the unsaved edit count), "Write fields to file…" (dry-run report, then
    confirm), and the obs count.
  - Filter is a builder of typed clauses published under the table's own source key. Group
    takes one field, with collapsible headers and obs counts. Fields sets column visibility and
    order in the `columns` prop.
- Headers show the type glyph (Aa, #, ◉, ◇, ☑) and the provenance marker: none for obs from the
  file, a filled dot for a saved field, a hollow amber ring for unsaved edits. A Settings ›
  Provenance badges switch toggles the markers (a per-browser preference).
- The column menu sorts and hides; for fields it also renames, converts label ↔ text, and deletes
  (with confirmation). **+** adds a label or text field.
- Label and text cells edit inline into a client buffer: amber bar, Save posts, Discard drops.
  Field operations apply at once through new `DatasetQuerySession` methods
  (`renameAnnotationColumn`, `setAnnotationDtype`) and the PATCH route in
  `routes/annotations.ts`; every field write saves the Parquet sidecar before responding.
- Rows: click focuses; shift-click selects a range and ⌘-click toggles. The selection becomes an
  observation set published on the table's `selection` facet; the table never filters itself.
- `annotate` is deleted (component, services, CommitPanel, predicate writes, autosave). The
  `annotate` preset became `exploration`: Embedding, Image viewer, Crop gallery, Table.

**Files:** `packages/components/src/table/{DataTable,Toolbar,fields,provenance,useTableQuery,view,definition,contracts}.ts(x)`,
deleted `packages/components/src/annotate/**`, `packages/components/src/catalog.ts`,
`packages/sdk/src/{host,index}.ts`, `apps/ndea/src/frontend/core/{component/definitions,component/runtime/host,coordination/filter-binding,shell/flyouts}.ts(x)`,
`apps/ndea/src/server/{store,app,observations,protocol,presets,routes/annotations}.ts`,
`apps/ndea/src/presets/exploration.json`, `packages/protocol/src/index.ts`, `README.md`, `CONTRIBUTING.md`, `docs/content/**`.

**Checked:** `vp run verify` green (17/17). `vp run build` (DuckDB 2). Binary smoke on infectomics:
the exploration preset rendered the four tiles; the toolbar and filter builder opened in the
standard frame; header glyphs and markers showed. The agent's dev smoke covered the rest:

- search "B/2/" gave 11,025 obs; filter `t > 60` gave 5,885 across linked views;
- group-by, rename, convert and delete all worked; Save persisted after a reload; Discard
  cleared the buffer;
- shift and ⌘ selection narrowed the embedding and gallery;
- the dry-run write report was cancelled, so nothing was written to the test data.

**Deferred**

- Column resizing.
- Bulk "label all selected rows".
- Persisting search and group collapse.
- String columns from the file are classed as category when they have ≤200 distinct values
  (`ponytail:`).

**Remaining differences**

- The prototype's table shows saved annotation fields with coloured label pills from the d1–d9
  set; ours use neutral pills for labels.

## Phase 5: ⌘K switcher

**Changed**

- `core/shell/CommandMenu.tsx` replaces the theme-only palette. It is a centred 760px window on
  `@ndea/ui` `command` over the `--scrim` backdrop (no blur), with "Switch layout or dataset…
  type > for commands".
- Default mode lists:
  - Layouts: one until G2, with a mini wireframe and the "current" marker.
  - Datasets: obs counts per dataset; picking one publishes `{op:"eq", column:"_dataset"}`
    under source `dataset` in filter scope `A`, and "All datasets" clears it. The datasets sit
    as children of "All datasets", so → / ← work and G3 can add collections as a level above.
  - A preview pane with the labelled wireframe, tile count and view titles.
- `>` lists commands: theme, toggle sidebar (⌘B), open each flyout, and for the selected tile
  fullscreen, copy reference, split and remove; plus add a component to the first empty tile.
  The recovery page gets commands only.
- The empty-tile component rule moved to `dashboard.ts` (`EMPTY_TILE_CHOICES`), shared by the
  empty tile and the menu. Wireframe cells use `bg-accent`, which stays visible in light theme.

**Files:** `apps/ndea/src/frontend/core/shell/{CommandMenu,Shell,LayoutWireframe}.tsx`,
`App.tsx`, `core/workspace/{WorkspaceShell,DashboardPane,dashboard}.ts(x)`; deleted
`components/ThemeCommandPalette.tsx`.

**Checked:** `vp run verify` green. `vp run build`. Binary smoke on infectomics: ⌘K opened the
760px menu with the layout row, the preview (4 tiles: Embedding · Image viewer · Crop gallery ·
Table) and the two datasets (30,951 / 39,170 obs). The agent's smoke covered the rest: picking a
dataset narrowed the table to its obs, "All datasets" restored 70,121, and the `>` commands for
theme, flyout, copy reference, split, fullscreen and add component all worked.

**Deferred:** the preview always shows the one layout; it follows the highlighted row once G2
adds more (`ponytail:` in `CommandMenu.tsx`).

**Remaining differences**

- Screenshot 02's "8 in JUMP pilot" counts and the Collections group need G2/G3 (phase 6).
- Layout rows have no subtitle (the prototype shows "Exploration", "Images", …) until layouts
  have names.

## Phase 6: tabs, named layouts, collections (schema)

**Changed**

- Named layouts (G2, format v3): the document is
  `{ data, layouts: { [id]: { name, spec } }, layout, state }`.
  - Element ids are unique across layouts; data sources and links are shared.
  - A v2 file is refused with "delete <file> to reseed it from the preset" (no migration; the
    user waived compatibility).
  - Ops `add_layout {id?, name, from?}`, `rename_layout`, `remove_layout`, `set_active_layout`.
    Element ops find the layout holding their element; `add` targets the active layout.
  - The runtime manager stops bodies outside the active layout and starts them on switch.
  - The Layouts flyout lists layouts with wireframes and offers New from template (blank, copy
    of each), Duplicate, Rename and Delete. ⌘K lists every layout, and its preview follows the
    highlight.
- Tabs (G1): a `tabs` component (view children, `active` prop); a bare view leaf is a one-tab
  tile.
  - Ops `add_tab`, `move_tab`, `close_tab`, `set_active_tab`.
  - The header strip shows every tab, × on multi-tab tiles, and **+** for a component menu.
  - Dragging a tab onto another tile's strip moves it without remounting its body; dragging onto
    a body still swaps tiles.
- Collections (G3, one per server run):
  - The project YAML takes `collections:` (list or map); datasets outside any collection form
    an implicit collection, so old project files open as one. `ndea view --collection <name>`;
    the default is the first collection.
  - Metadata and status report `collections` with metadata-only obs counts.
  - `POST /api/collection` rebuilds the session in-process (`Bun.serve` `server.reload`): it
    clears dataset filters (a `system` revision), re-ingests, and pushes `session/watch`, so
    tabs reload.
  - The Data flyout and ⌘K "Collections" show collection › datasets: include toggles inside the
    current collection, Switch (with confirm) for the others. MCP `list_collections`.
- The `exploration` preset is v3 with two layouts: Exploration (Embedding; Image viewer + Crop
  gallery; Table + Histogram tabs) and Review.

**Files:** `apps/ndea/src/frontend/core/workspace/{dashboard,document,types,data-sources,edits,workspace-store,compare,DashboardPane,EmbeddingChip,LinksPopover,ViewSettings}.ts(x)` + tests,
`core/component/runtime/workspace-runtime.ts`, `core/coordination/coordination.ts`,
`core/shell/{LayoutWireframe,flyouts,CommandMenu,collections,CollectionSwitchDialog}.ts(x)`,
`core/session/DatasetSessionProvider.tsx`,
`server/{workspace,mcp,app,state,status,ws,remote-render,routes/workspace,routes/meta,routes/collection}.ts`,
`cli/{config,startup,commands/view}.ts`, `cli/startup/{datasets,server,session}.ts`,
`packages/protocol/src/{index,status}.ts`, `presets/exploration.json`, docs.

**Checked:** `vp run verify` green (17/17). `vp run build`. Binary smoke with a three-collection
project YAML:

- `--collection day-24` ingested 30,951 obs.
- ⌘K showed layouts Exploration/Review and collections day-24 / day-22 / both (30,951 / 39,170 /
  70,121) with dataset rows.
- The Table tile showed Table × + Histogram tabs.
- The Layouts flyout switched to Review (document `layout: "review"`).
- `POST /api/collection {name:"both"}` switched the session and the open tab reloaded to
  70,121 obs.

The agents' smokes also covered:

- layout add / duplicate / rename / delete;
- adding and closing tabs, and a tab drag that kept the same canvas node;
- MCP `add_layout` / `set_active_layout` / `add_tab` / `move_tab` / `close_tab`;
- the v2 refusal message;
- dataset include toggles inside "both", and a switch that cleared a stale dataset filter.

**Deferred**

- `move_tab` across layouts is refused.
- A one-tab tile has no ×; it is removed from the header context menu.

**Remaining differences**

- The prototype's project switcher on the app mark (several projects) is out of scope: one
  project per server.
- "Compare with <collection>" from the prototype's Collections flyout is not built.

**Note:** the user's `vp up -r -L` dependency upgrade (DuckDB 2.0 and the rest) landed inside the
phase 3 commit `34e84d6`, because it was already in the tree. `7e971b0` and `d8e6b45` adapted the
duckdb-zarr and static addon builds to DuckDB 2.

## Phase 7: proposals

**Changed**

- A proposal queue on the server (`server/harness.ts`, in memory: a restart drops pending
  proposals). Harness edits mode is `propose` (default) or `direct`.
  - In propose mode MCP `edit_dashboard` returns `{ status: "proposed", id, changes }`. The
    exceptions are `set_filter` ops, which apply directly because filters are exploration
    state.
  - An invalid batch is rejected at once with a `rejected` push.
  - `get_proposal` reports per-change status.
  - `patch_workspace` and `restore_revision` are refused in propose mode with a hint.
- Accept re-runs the selected named ops against the current revision and commits one
  `workspace.patch` with the harness as the actor. A change that no longer applies becomes
  `invalid` with its reason.
- Every MCP tool call lands in a bounded feed (50, newest first) with a summary and outcome.
- `packages/protocol` `harness.ts`: `HarnessState`, `Proposal`, `ToolCall`. `/ws harness/watch`
  pushes state and `rejected` events. REST: `GET /api/harness`, `PUT /api/harness/mode`,
  `POST /api/proposals/:id/accept|reject`. Change summaries come from the shared `describeEdit`
  in `core/workspace/edits.ts`.
- Browser (`core/proposals/*`):
  - New tiles from pending `add` changes render as ghost tiles (dashed `--primary`, "Proposed ·
    Histogram", "Proposed by smoke", Reject / Accept, no live body).
  - Other changes (sources with a before → after diff, props, removals) appear in the bottom
    bar ("smoke proposes 2 changes", Review / Reject all / Accept all) and in the Harness flyout.
  - A rejected harness edit shows one toast with its reason and shakes the Harness rail button
    once.
  - Settings › Harness edits `Propose | Apply directly`; the Harness flyout shows agents, the
    tool-call feed (write calls in `--primary`), and pending proposals.

**Files:** `packages/protocol/src/{harness,index,status}.ts`, `apps/ndea/src/server/{harness,mcp,workspace,status,ws,app,routes/harness,routes/workspace}.ts` + tests,
`apps/ndea/src/frontend/core/workspace/{edits,DashboardPane}.ts(x)`, `core/proposals/{harness,preview,Proposals}.ts(x)` + tests,
`core/shell/{Shell,flyouts}.tsx`; deleted `core/shell/presence.ts`.

**Checked:** `vp run verify` green (17/17). `vp run build`. Binary smoke on infectomics:

- An MCP `edit_dashboard` (add histogram + set_data) returned `status: proposed` with two change
  summaries; the browser showed the ghost tile and the bar with the source diff.
- An invalid `set_props` was rejected ("no element "nope"") and landed in the feed.
- Accept on the ghost committed revision 2 with actor `{kind:"mcp", agent:"smoke"}`, and the
  ghost became a live Histogram tile.
- Rejecting the source left no pending proposals.
- The Harness flyout listed the agent and both tool calls.

The agents' smoke also covered Accept all / Reject all and Apply directly making the next edit
immediate.

**Deferred**

- `add_tab` into an existing tile, and `add` into another layout, go to the review list instead
  of a ghost (`ponytail:`).
- Right after an accept, the ghost and the real tile can both show for a moment.

**Remaining differences**

- The prototype animates the ghost's dashed outline; ours enters with `animate-nd-in` only.
- The prototype's Settings label reads "Suggest"; we use the README's "Propose".
