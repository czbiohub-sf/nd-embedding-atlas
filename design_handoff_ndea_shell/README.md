# Handoff: ndea shell redesign

Read this whole file before writing code. It maps a high-fidelity HTML prototype onto the existing `nd-embedding-atlas` codebase (`refactor/agentic-oriented-design`), states what already exists, and lists what has to change.

## About the files in this folder

`prototype/ndea Shell v2.dc.html` is a **design reference built in HTML**, not production code. It runs on mock data (`prototype/ndea-core.js`: procedural microscopy, a 2,600-point sample per dataset, fake counts) and a small in-browser runtime (`support.js`). Do not port its code, its state model, or its mock data. Recreate its look and behaviour inside the existing app: React 19, json-render over the workspace document, `@ndea/ui` (shadcn on Base UI), Tailwind v4, Mosaic and DuckDB, TypeGPU scatter.

**Fidelity: high.** Colors, type, spacing, radii, motion and interactions are final. Match them using the tokens in `design-system/tokens/`.

Open the prototype in Chrome to try it. ⌘K, the sidebar, view settings (gear), box and lasso, the legend, the axis picker, the links popover, table editing and toasts all work there.

## Step 0: compare against the code before building

The codebase already does most of the data and agent work. Before writing any UI:

1. Read `AGENTS.md`, `apps/ndea/src/frontend/core/workspace/dashboard.ts`, `apps/ndea/src/server/workspace-edits.ts`, `apps/ndea/src/server/mcp.ts`, `apps/ndea/src/frontend/core/coordination/types.ts`, `packages/components/src/catalog.ts` and `packages/ui/src/components/`.
2. Check every item in **Gap list** below against the code. Write `docs/design-gap-report.md` saying, for each item, whether it already exists, needs extending, or is new, and which files it touches.
3. **Stop and wait for review** before changing the workspace document schema (items G1, G2, G3, G6).

## Vocabulary

Use the terms in `docs/glossary.md` in UI copy, code comments and MCP descriptions. How they map to code today:

| Design term | In the codebase | Note |
| --- | --- | --- |
| Workspace | workspace document `{ data, spec, state }` | same |
| Layout | the document's single `spec` | design has several per workspace (G2) |
| Tile | a leaf region of the `split` / `stack` tree | same idea; the tile is the grid cell |
| Empty tile | `slot` element | rename in UI copy only; keep `slot` in code |
| Tab | (none) | new: a tile holds 1..n tabs (G1) |
| View | a view element (`scatter`, `table`, `gallery`, `imageViewer`, …) | settings live on the element's props |
| Component | `ComponentDefinition` type in `@ndea/components` | AGENTS.md already says "component, not node" |
| Link | coordination scope `state[type][scope]` + `$bindState` | "scope" stays in code and MCP docs |
| Source | `data[name]` data source | same |
| Collection / Dataset | project YAML `datasets[]` (AnnData + `plate_path`) | collection grouping is new (G3) |
| obs | observation row | every count in the UI says "obs" |
| Harness | MCP client (actor `mcp` + `X-Ndea-Agent`) | the app has no chat |

## Screens and parts

Screenshots: `screenshots/01-default.png` (dark, exploration layout), `02-command-menu.png`, `03-view-settings.png`.

### 1. Shell frame
- **Sidebar rail**, 32px wide, pinned to the left edge, 4px from the window edges, full height. Top: app mark (the green dot on the mark means a harness is connected). Below it: Search ⌘K, Layouts, Data, Links. Bottom: Harness, Settings. Buttons are 26px square, 14px Lucide icons at 1.5 stroke.
- Hovering a rail button opens its **flyout** panel (312px wide) *over* the tiles; it never pushes them. Click or ⌘B pins it. The flyout has the same tabs as the rail.
- **Tile grid**: CSS grid, 4px gutters, 4px outer edge. Tiles: surface fill, 7px radius, 1.15px tile ring (`--tile-ring`), no shadow. Existing `split` / `stack` ratios drive the grid; keep the current resize handles.
- No top bar and no status bar. Vertical space comes first.

### 2. Tile header (30px)
Left: tab strip (segmented look; the active tab sits on a raised `--card` thumb), then **+** to add a tab. Right, in this order: link indicator (Lucide `git-fork`-style icon + one 4px dot per linked scope, colored `--scope-*`), view settings (gear), copy reference (link), fullscreen. Nothing else: no subtitle, no color-by button, no counts.

### 3. Views
- **Embedding** (`scatter`): a floating control group in the top-left, one column split by dividers: pointer / box / lasso (shortcuts V, B, L; shift adds, ⌥ subtracts), then legend, point size, axes. Legend opens as a popover beside the group or can be **pinned** into the view's bottom-left. Bottom-right: axis picker `x UMAP1 ⌄ │ y UMAP2 ⌄ │ swap`, always shown, even for 2-dim embeddings; scrolling over x or y steps through dimensions. After a lasso, a pill at the top centre shows `1,284 obs · lasso` with Invert, Save as source and Clear. 2D/3D is a single toggle.
- **Image viewer**: channels button in the top-left opens the channel panel to its right (below on tiles under 300px wide): per channel visibility, colormap, contrast limits over a histogram (`RangeSlider`). Scale bar bottom-right. Focus box drawn in `--focus-mark`.
- **Crop gallery**: square crops, focused crop outlined 2px `--primary`. Click focuses.
- **Table**: Airtable-lite. Toolbar: search, then one outlined button group `Filter │ Sort │ Group │ Fields`, then Save / Discard when there are unsaved edits. Column headers show a type glyph (Aa, #, ◉, ◇, ☑) and a provenance marker: none = from `obs` in the file (read-only), filled dot = saved annotation field, hollow amber ring = unsaved. Edited cells get a 2px amber left bar. Label and text columns are edited inline; **+** adds a field. Click a row to focus it everywhere; shift-click selects a range and ⌘-click toggles, and the selection feeds the filter link. **The table replaces the Annotate component** (G5). No keyboard shortcuts in the table.
- **Histogram**: unchanged apart from chrome.

### 4. Overlays (one standard)
All pop-ups share one frame: `--card` background, 8.4px radius, 0.5px keyline plus `--shadow-popover`, 6px inner padding, rows 6×8px with 4.9px radius, open with a 4px rise + 0.985 scale over 140ms. This covers view settings, legend, links, color-by, the embedding picker, channels, column menus, filter builder, sort, group and fields.
- **View settings (gear)**: an anchored popover with an editable title and Display / Data / Links tabs. Controls follow one rule: a switch for on/off, an in-theme dropdown for choices, segmented only for 2–3 options. Do not repeat controls that already sit on the view (point size, color-by, axes live in the control group).
- **Dropdowns**: never the native OS `<select>`. Use `@ndea/ui` `select` / `combobox` styled as `design-system/components/forms/Select.jsx`: muted trigger, listbox with a check on the current value.
- **Tooltips**: every icon-only button. 500ms delay, instant when moving between neighbours, same surface as popovers. `@ndea/ui` `tooltip` / `hover-tip`.
- **Toasts**: bottom-right stack, 356px wide, title + description, about 4s. Sonner is already in `frontend/components/ui/sonner.tsx`; restyle it to `design-system/components/overlay/Toast.jsx`.
- **⌘K command menu**: centered window, fixed 760px wide. By default it switches things: layouts (each with a mini wireframe of its grid) and collections › datasets as an expandable tree. A preview pane on the right shows the highlighted layout. Typing `>` switches to commands. ↑↓ ↵ esc, → / ← expand and collapse. `@ndea/ui` `command` is the base; see `design-system/components/command/CommandMenu.jsx`.
- **Proposals**: an edit from the harness can arrive as a ghost tile (dashed outline in `--primary`) or a source diff, with Accept / Reject on each change and Accept all / Reject all (G6). An edit the workspace rejected shows once with its reason and a single shake.

### 5. Removed on purpose
No revision timeline or History panel in the UI (the server history stays as it is). No chat or agent text input. No ⌘1–9 layout shortcuts. No "All embeddings" small-multiples tile. No component-type switch in settings. No close button on the pinned legend. No glass or blur: `@utility glass` must not be used for chrome; use the solid `--overlay` token.

## Design tokens

`design-system/tokens/` is the source of truth. The names are shadcn's (`--background`, `--foreground`, `--card`, `--primary`, `--muted`, `--muted-foreground`, `--accent`, `--border`, `--ring`, `--radius`, `--chart-1..5`) plus `--surface` (tile bodies), `--text-muted`, `--tile-ring`, `--line-2`, `--focus-mark`, `--dirty`, `--d1..d9` (categorical data), `--scope-*` and `--viridis`. Light is `:root`; dark is `.dark` on `<html>` and is the default.

Differences from `apps/ndea/src/frontend/app.css` today:

| Token | app.css now | Design |
| --- | --- | --- |
| dark `--background` | `#000000` | `#0a0a0a` (Pierre 950); tiles `#101010`, popovers `#171717`, inputs `#1d1d1d` |
| dark `--primary` / `--ring` | periwinkle `#6E4FF9` | Biohub teal `#26CFDB` (periwinkle stays the light-mode accent) |
| dark `--border` | `oklch(1 0 0 / 16%)` | `#262626`; tile ring `#404040` (1.15px) |
| selection | `--accent` grey | `#19283c` fill with `#9fd8ff` text (Pierre selection) |
| focus marker | n/a | `#ffd452` dark, `#000000` light |
| `--radius` | `0.45rem` | 7px, scale 3.5 / 4.2 / 4.9 / 7 / 8.4 / 9.8 |
| fonts | Geist Mono for both | Geist (UI) + Geist Mono (data: ids, counts, field names) |
| light keylines | `oklch(0.87 0 0)` | `#C7CBCF` (Biohub keyline), tile ring `#A0A4AC` |

Font sets (Helvetica, Plex, Terminal…) are optional classes in `tokens/typography.css`; ship the default first.

Motion: 140 / 180 / 260ms, `cubic-bezier(.2,.7,.2,1)`, no bounce. Animate rare actions (layout change, popover open, a proposal arriving); keep frequent ones instant (focus, hover, tab switch). The prototype's `motion` tweak: off / subtle (default) / full.

## Gap list (check each against the code)

**G1. Tabs inside a tile.** The spec tree has `split`, `stack`, `slot` and view leaves. The design needs a tile to hold 1..n views with one active. Suggested: a `tabs` layout element (`children: any`, prop `active`) whose children are view elements, plus `edit_dashboard` ops to add, move and close a tab. `ComponentRuntimeManager` already keeps bodies alive while they move, which covers dragging a tab to another tile.

**G2. Several named layouts per workspace.** The document has one `spec`. The design switches between "Exploration", "Review", … from the sidebar and ⌘K. Suggested: `layouts: { [id]: { name, spec } }` plus `activeLayout` in session state, or one spec per layout with `data` and `state` shared. This is a schema change, and the file format has no migrations, so decide deliberately.

**G3. Collections.** The design groups datasets that share an obs schema (one AnnData + OME-Zarr per plate, well or FOV) into collections, and shows collection › dataset in the Data flyout and ⌘K. The project YAML has a flat `datasets[]`, and ingest already supports unions with `_dataset`. Suggested: a `collections` section in the YAML that names member datasets; a collection opens as their union, and picking one dataset is a filter on `_dataset`.

**G4. Axis picker for n-dimensional obsm.** The scatter takes `zDim` for 3D. Add `xDim` / `yDim` props (column indices into the obsm matrix), and have `/api/scatter-positions` return those columns. `@ndea/zarr` already reads obsm shapes.

**G5. Table as the annotation surface.** Remove `annotate` from the catalog and from the `annotate.json` preset; move labeling into `table`: inline editing of label and text columns, add / rename / convert / delete a field, Save and Discard. Writes go through the existing annotation routes and `commitObsColumns`. Column provenance (obs / saved / unsaved) comes from the column catalog plus the client's unsaved set.

**G6. Proposals.** `edit_dashboard` applies right away. The design's default setting is "Propose": harness edits land as pending changes the person accepts or rejects one by one; "Apply directly" keeps today's behaviour. Suggested: a pending-edits queue on `Workspace` (not in the document), pushed over `workspace/watch`; accepting commits through `workspace.patch` with the harness as actor. Rejected and invalid edits are kept for display only.

**G7. Lasso selection into the filter link.** GPU lasso and marquee exist. Make sure a selection publishes a typed clause into the view's filter scope under its own source key (`inSet` after `POST /api/sets`), so linked views narrow and the selection pill can show the count from `get_result`.

**G8. Link indicator and links popover.** Data exists (`$bindState`, `bind` / `unbind` ops). UI is new: per-view indicator dots, a popover listing each scope with its value, its member views and Unlink, and hover-to-highlight of member tiles.

**G9. View settings popover.** One popover per view, built from the component's config `schema` (switch for booleans, dropdown for enums, segmented for 2–3 options) so new components get settings for free. Writes go through `set_props`.

**G10. Copy reference.** Copies a stable reference to a view (for example `ndea://<workspace>/<element-id>`) for pasting into the harness. Check whether `get_result` or `get_workspace` should accept it.

## MCP surface the UI depends on

Already in `mcp.ts`: `get_workspace`, `list_components`, `list_columns`, `get_result`, `edit_dashboard` (ops `set_data`, `remove_data`, `add`, `set_props`, `remove`, `swap`, `bind`, `unbind`, `set_filter`), `patch_workspace`, `get_history`, `restore_revision`, `create_observation_set`.

Likely additions, following the AGENTS.md rule of adding agent operations to `workspace-edits.ts` and not as new write paths:
- `edit_dashboard` ops: `add_tab`, `move_tab`, `close_tab`, `set_active_tab` (G1); `add_layout`, `rename_layout`, `set_active_layout` (G2).
- A way to submit edits as a proposal and to list or resolve pending ones (G6).
- `list_collections` or a collections field in `get_workspace` (G3).

## Recommended build order

1. **Tokens and shell frame**: theme tokens, fonts, sidebar rail and flyouts, tile chrome, tooltips, toasts, the standard popover frame. No schema changes.
2. **Embedding controls**: control group, box and lasso into the filter link (G7), legend popover and pin, axis picker (G4).
3. **Links and settings**: link indicator and popover (G8), view settings popover (G9), copy reference (G10).
4. **Table as editor** (G5), then remove `annotate`.
5. **⌘K** switcher with layout previews. It works on one layout until G2 lands.
6. **Schema work, after review**: tabs (G1), layouts (G2), collections (G3).
7. **Proposals** (G6).

## Files in this folder

- `prototype/ndea Shell v2.dc.html`, `ndea-core.js`, `support.js`: the interactive reference. Open the `.dc.html` in Chrome.
- `design-system/`: tokens (`tokens/*.css`, the source of truth), reference React components (`components/**/**.jsx` with `.d.ts` props and `.prompt.md` usage notes) and `readme.md` (visual rules, content rules, iconography). The JSX is a reference for exact values and structure; rebuild each control on `@ndea/ui`.
- `docs/glossary.md`: one name per concept.
- `docs/system-language.md`: interface, workspace, edits, proposals, links, components, as a vocabulary rather than an API.
- `docs/ux-principles.md`: the 15 principles behind the design, with sources.
- `screenshots/`: default layout, ⌘K, view settings.
