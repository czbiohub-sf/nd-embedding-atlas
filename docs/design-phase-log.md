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
