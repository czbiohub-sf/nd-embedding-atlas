# Node-shell pivot — hard pivot to the node-based dashboard

Branch: `spike/annotation-ux`. Issue context: #124 annotations + node workspace.

## Goal

Make `/` render the node workspace (`WorkspaceShell`), redirect the legacy
`#/graph` deep link to `/`, keep `#/nd-spec`, and delete the old Dockview
`DashboardShell` tree plus its now-dead code — without touching the protected
paused-batch files.

Verbatim user goal: "I want http://localhost:5173/#/graph to be
http://localhost:5173, and not have the older designs/features on the original
one. Hard pivot to the new node-based dashboard."

## Protected paused-batch files (NEVER modify)

- `src/frontend/scatter-gpu/**`
- `src/frontend/components/scatter/ScatterView.tsx`
- `src/frontend/components/scatter/HighlightFocusOverlay.tsx`
- `src/frontend/plugins/gallery/GalleryPluginView.tsx`
- `src/frontend/plugins/annotate/**`
- `src/frontend/core/workspace/feedback.ts`
- `src/frontend/core/workspace/node-counts.ts`

## Phases

### P0 — Relocate plugin registration to the boot path (unblocks everything)

`registerPlugins()` currently runs only as a module side-effect of
`DockviewShell.tsx`. The node shell depends on the registry already being
populated. Move the call to `main.tsx` (after `roaringLibraryInitialize()`,
before `createRoot().render()`). `registerPlugins()` is idempotent.

### P1 — Flip routing

`App.tsx`: keep the `#/nd-spec` early return. Add a normalization effect: if
`window.location.hash === "#/graph"`, `history.replaceState` to strip the hash
to `/`. Always render `<CollectionsSheetProvider><WorkspaceShell/></...>`.
Remove the `DashboardShell` import (keep `DashboardProvider`).

### P2 — Parity decisions (read-only / recorded)

| Feature | Decision | Note |
|---|---|---|
| Scatter + lasso | port (already full parity) | scatter node, lasso push port |
| Table viewer | port (full parity) | table node reuses shared DataTable/useTableQuery |
| Annotation writing | port (full parity) | annotate node → /api/writeAnnotationByPredicate |
| Gallery / crops | port (full parity) | GalleryPane + shared hooks kept |
| Wrangle / filtering | port (exceeds old) | wrangle node + transform-filter |
| Dockview tiling | accept-loss | StagePane split-tree + canvas placement |
| Image viewer (fov) | port | fov node mounts CropViewer |
| Export to .zarr | port via collections | ExportCollectionDialog (kept) |
| Collections | port (full parity) | CollectionsSheet mounted by node shell |
| Scatter trajectory toggle (overlay) | port (independent of TrackPane) | survives untouched |
| Track/trajectory PLAYBACK gallery | defer | needs a future `track` node |
| PiP auto-open on highlight | accept-loss | convenience only |
| Float scatter to window | accept-loss | nodes ARE windows |
| Point-size slider | defer | store + bus survive; re-expose later |
| Highlight ring / legend / isolation | port (full parity) | inside ScatterView/ScatterContent |
| Metadata refresh | port (full parity) | shared DashboardProvider |

### P3 — Delete old Dockview shell tree + dead code

Delete (every importer also deleted):
- `dashboard/DashboardShell.tsx`, `components/layout/DockviewShell.tsx`,
  `core/layout/layout-host.ts`
- `components/layout/{BottomDock,PanelHotkeys,FloatingScatterWindow,ViewerPiP}.tsx`,
  `components/FloatingWindow.tsx`, `hooks/useFloatingWindow.ts`
- `components/table/{TerminalTable,TrackPane,TrackGallery,TrackGalleryCard}.tsx`
  — KEEP `useGalleryChannels.ts`, `useGalleryCropQuery.ts` (shared with gallery/),
  `DataTable.tsx`, `useTableQuery.ts`, `GalleryPane.tsx`
- `components/devtools/{DevtoolsDrawer,RenderSettingsPlugin,ScatterStatePlugin}.tsx`
- `components/CommandPalette.tsx`, `components/toolbar/ExportDialog.tsx`
  — KEEP `collections/ExportCollectionDialog.tsx`
- `components/collections/ActiveCollectionCallout.tsx`
- `stores/FloatingScatterStore.ts`, `stores/ViewerPiPStore.ts`

Edit the surviving scatter files to drop the dead Dockview `panelApi` surface:
- `ScatterToolbar.tsx`: remove `DockviewPanelApi` import, `colorSourceToString`
  import (noUnusedLocals fix), `addFloatingScatter` import, the
  `Maximize2`/`PictureInPicture2Icon`/`X` lucide icons, the `panelApi` prop +
  destructure, and the three `{panelApi && (...)}` JSX blocks. KEEP `Waypoints`,
  `Bookmark`, `BoxSelect`, `ChartScatter`, `LassoSelect`, and the trajectory/fit
  blocks.
- `ScatterContent.tsx`: remove `DockviewPanelApi` import + prop + destructure +
  pass-through. KEEP `colorSourceToString` (live at the colorByColumn path).
- `ScatterPluginView.tsx`: remove `DockviewPanelApi` import, the `panelApi`
  const, and the `panelApi` prop pass-through.

### P4 — Clean up barrels + comments

- `dashboard/index.ts`: drop the `DashboardShell` re-export.
- `App.tsx`: update the hash-route docstring.

### P5 — Remove the dockview-react dependency (DEFERRED to a human)

Per the execution task, npm dep removal + lockfile churn is left to a human.
After P3 there are zero `dockview-react` imports in `src/frontend`, so
`vp remove dockview-react` is safe whenever a human runs it.

## Hard constraints

- Each phase leaves `vp check` green (0 errors, incl. tsconfig noUnusedLocals)
  and `bun test` passing.
- The dead `panelApi` blocks are deleted outright — no `unknown` retype.
- `useDrag.ts` becomes orphaned after `useFloatingWindow` deletion but is left
  in place (not in the plan); flagged as removable.
