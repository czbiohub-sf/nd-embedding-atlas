# Frontend Skill Review — spike/annotation-ux

Worktree reviewed: `/Users/sricharan.varra/Biohub/nd-embedding-atlas.spike-annotation-ux`. 9 verified skill dimensions, deduped and ranked by impact (severity × reach). All file:line refs verified against the actual code. (70 raw findings → 49 distinct after dedup.)

## 1. Executive summary

The foundation is strong and intentional: a 3-tier OKLCH token system, named dense-type rungs, a single Zod wire-protocol source of truth, a re-disposed-not-remounted xyflow canvas with body reparenting, and a disciplined zarrita cast boundary. The debt clusters in three places: (a) the node-graph workbench's accessibility and over-subscription, (b) cross-consumer state/caching contracts in the table + crop paths, and (c) two unsoundness gaps the config could close at the root.

Top ~10 highest-leverage fixes:
1. **Add `noUncheckedIndexedAccess` (+`exactOptionalPropertyTypes`) to tsconfig** — the single highest-leverage type fix; the zarr/GPU/node-count code indexes arrays and records on nearly every line. `tsconfig.json`.
2. **Wire `device.lost` + `onuncapturederror`** — a GPU context loss silently bricks every scatter panel; recovery plumbing already exists. `device-manager.ts`.
3. **Keyboard path to connect/cut/resize/move nodes** + stop `preventDefault`-ing every Tab — the canvas is keyboard-unusable for its core task. `WorkspaceCanvas.tsx`.
4. **Narrow `NdGraphNode` subscriptions** — every node subscribes to the whole `s.nodes`/`s.edges` map → O(N) re-renders per single-node edit. `NdGraphNode.tsx`, `feedback.ts`.
5. **`aria-label` icon-only toolbar/node buttons** — hover-only tooltips and `title` are not accessible names; the canvas control set is nameless to AT. `ScatterToolbar.tsx`, `nd-icon-button.tsx`.
6. **Memoize `columns` at both DataTable call sites** — the annotation `refreshMetadata()` path actively churns it, re-firing scroll fetches. `TerminalTable.tsx:63`, `TablePluginView.tsx:38`.
7. **One app-level crop blob-URL subscriber** — duplicated per-component; two mounted galleries revoke-all over a shared key namespace. `TrackGallery.tsx`, `GalleryPane.tsx`.
8. **Add error/loading states to canvas node counts** — `catch{return}` freezes stale numbers; sibling WranglePane already does this right. `node-counts.ts`.
9. **Unify the two semantic color vocabularies + collapse arbitrary `text-[Npx]` to named rungs** — systemic, ~50 sites. `app.css`, `nd-node-frame.tsx`.
10. **`ignoreInputs` on Mod+B/Mod+J hotkeys** — they fire while typing in the annotation/collection name inputs this branch adds. `PanelHotkeys.tsx`.

Counts by severity: **High 7 · Medium 20 · Low 22** (49 distinct findings after dedup).
Counts by dimension: React perf 7 · Type safety 9 · TanStack/caching 8 · Accessibility 9 · Visual/design 7 · Tailwind 6 · Dashboard UX 8 · WebGPU 6 · Code health 10 (overlaps deduped below).

## 2. Cross-cutting patterns (systemic wins — fix the pattern, not the instances)

These recur across files and dimensions. Fixing the pattern beats fixing each site.

- **C1 — Over-subscription to whole store slices (High).** Per-node and per-consumer components subscribe to entire maps/objects instead of derived slices: `NdGraphNode` selects all of `s.nodes`+`s.edges` (`NdGraphNode.tsx:102`, `feedback.ts:88-89`); `useDashboard()` returns the whole context value so ~30 consumers re-render on each highlight (`useDashboard.ts:5-12`, `DashboardProvider.tsx:260`); FPS dispatch rebuilds the shared `ScatterUIState` object (`ScatterView.tsx:317`). Fix: selector-keyed reads and split high-churn telemetry from low-churn UI state. (React perf 1, 3, 4)
- **C2 — `noUncheckedIndexedAccess` off makes index helpers lie (High).** With the flag off, `arr[i]`/`record[key]`/tuple reads type as non-undefined while the runtime can be undefined: `helpers.ts` `at()` (127-131, 161-164), parsers, `node-counts.ts` `row[c${i}]`. Landing the flag surfaces all of them at once. (Type safety 1, 2)
- **C3 — Type-scale fragmentation: ~50 arbitrary `text-[Npx]` (incl. half-pixel) bypass named rungs (High).** `--text-2xs`/`--text-3xs` exist and are used 130+ times, yet `nd-*` and several workspace files scatter 8/8.5/9/9.5/10.5/11.5px. The repo's own `ui/README.md:111` bans this. Fix: collapse to rungs; add one named token if a sub-10px rung is genuinely needed. (Visual 1, Tailwind 2)
- **C4 — Two semantic color vocabularies (shadcn vs custom) that resolve to different values (High).** `text-muted-foreground`(0.76) vs `text-text-muted`(0.62); `bg-card`/`border-border` vs `bg-surface`/`border-border-subtle`. `Panel` (the shared primitive) is built on the shadcn family while every workspace surface uses the custom one. Pick one canonical family, alias the other one-directionally in `app.css`, codemod. (Tailwind 1, Visual 5)
- **C5 — Icon-only controls have no accessible name (High reach).** Toolbar buttons rely on hover tooltips (`ScatterToolbar.tsx`); node controls rely on `title=` only (`nd-icon-button.tsx:66-69`, `NdHandle`, `NdPort`). One-line `aria-label={title}` on `NdIconButton` names every node call site. (A11y 3, 7)
- **C6 — Glass-HUD recipe + small-button recipe hand-rolled instead of using the cva primitives built to absorb them.** Glass string in ~12 files (three competing blur syntaxes incl. the literal `backdrop-blur-md` the `Panel` glass variant was meant to replace); node-extras small button verbatim 5×. Route HUDs through `<Panel variant="glass">`, extract `NdMiniButton`. (Tailwind 3, 6)
- **C7 — Crop blob-URL GC + scoped-highlight resolution duplicated per component.** Blob revocation subscriber duplicated in `TrackGallery` and `GalleryPane`; focus-resolution block duplicated in `CropViewer`/`SingleCropViewer` (the code comments say "Mirrors"). Lift into `useCropBlobUrlGc()` + `useScopedHighlight()`. (TanStack 3, Code health 8)
- **C8 — `cursor:none` on the canvas + JS motion not gated by reduced-motion.** The canvas hides the OS cursor and substitutes a rAF-lerped dot that disappears over in-canvas controls; the lerp ignores `prefers-reduced-motion`. (A11y 9, Dashboard 2)
- **C9 — Sub-24px hit targets across the dense canvas.** `NdIconButton` 14-15px, `NdHandle` ports 11px, resize grips 14px — all below WCAG 2.5.8. Enlarge hit area (transparent inset) while keeping the small glyph. (A11y 6)

## 3. Findings by theme

### React performance & state
- **[High] NdGraphNode over-subscribes to the whole node/edge map** — `NdGraphNode.tsx:102` (`useWsSelector(s => s.nodes)`) + `useFeedbackChannels()` selecting full `s.nodes`/`s.edges` (`feedback.ts:88-89`). Store reassigns those maps on every node/edge mutation (`workspace-store.ts:204/287/489/…`), so any single-node edit re-renders all N nodes. Fix: pass only this node's badge slice via an `id`-keyed selector; do not select whole maps in a per-node component. (C1)
- **[Med] `deriveFeedbackChannels` recomputed per node = O(N²) per topology change** — `feedback.ts:44-74` runs a full-graph DFS, called once per `NdGraphNode`. Compute once per topology change (useMemo in `WorkspaceCanvas`/context above nodes), each node reads its channels by id.
- **[Med] FPS dispatch rebuilds shared UI-state object** — `ScatterView.tsx:317` → `SET_FPS` rebuilds `ScatterUIState` (`ScatterUIStateProvider.tsx:37-54`), re-rendering `selectedCount`-only consumers. Source is throttled to ~2Hz (not 60Hz), so the fix is context-splitting: a dedicated `<FpsReadout/>` context, not more throttling.
- **[Med] `useDashboard()` returns the whole value; ~30 consumers re-render on highlight** — `useDashboard.ts:5-12`; `highlightId` folded into memoized state (`DashboardProvider.tsx:260`). Highlight is click-driven (not hover). Route highlight through the existing `useHighlight()` bus; stop folding it into context state. (C1)
- **[Med] WorkspaceBodies mutates a ref during render** — `body-dock.tsx:206/210` `activated.current.add/delete` in the render body. Violates purity / breaks under StrictMode + concurrent. Reconcile in a `useEffect` keyed on nodes/placement/form/fullscreen.
- **[Low] LegendContext notifies parent via effects** — `LegendContext.tsx:121-130`. Move the `onIsolationChange`/`onDisabledChange` calls into the toggle handlers; drop the effects (also removes the idempotent empty-Set mount call). Bridge callbacks are already stable.
- **[Low] AnnotateView Apply enablement ignores wired input** — `AnnotateView.tsx:82`; null-predicate guard only fires post-click. Subscribe to `host.inputSelection` ('value' event), derive `hasScope` into `canApply`/inline warning.

### Type safety & type design
- **[High] tsconfig omits `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`** — `tsconfig.json`. Land `noUncheckedIndexedAccess` first; fallout concentrates in `src/zarr` + `scatter-gpu`. Fix at the source with narrowing, not `!`. (C2)
- **[Med] Index helpers declare non-undefined returns the runtime can violate** — `helpers.ts:127-131` (`SimpleCategorical.at`) and `161-164` (`SimpleNullable.at`) can return `undefined` (out-of-range/corrupt codes; live now that `write-obs.ts` hand-writes categorical codes). Normalize: `return c ?? null;`.
- **[Med] `as any` on the WebGPU adapter** — `device-manager.ts:44` `(adapter as any).info?.vendor`; drives a real `apple`-branch on workgroup sizing. Use `adapter.info as GPUAdapterInfo | undefined` (`@webgpu/types` already in `types`).
- **[Med] Worker `ColumnResult` reassembly trusts cross-thread data via `!`** — `readers.ts:382-394` (wide optional interface) + `570-595` (`r.data!`, `r.codes!`, …). Make `ColumnResult` a discriminated union keyed on `encoding`; the `!`s disappear and a malformed worker arm fails to typecheck.
- **[Med] Binary scatter-frame header parsed past Zod with no bounds check** — `parsers.ts:41-53` (`headerLen` used as length with no `5+headerLen <= byteLength` check); `parsePositionBlob:63`/`parseCategoryBlob:73` build TypedArrays with no remaining-length check. `parseContinuousValuesBlob:85-92` is the model done right — mirror it.
- **[Low] PRQL error JSON cast without validation** — `prql.ts:58-73`; unexpected-but-valid shape yields NaN CodeMirror offsets. Guard the tuple reads or use a 4-line Zod schema.
- **[Low] Return-only generic `toRows: <T>(result: unknown) => T[]`** — `node-counts.ts:26/89/98`; caller-chosen cast then string-indexed. Type it `Record<string, unknown>[]` and coerce at the use site. (`query<T = unknown>` helpers are honest — leave them.)
- **[Low] `ConfigRes` mixes open index signature with named members** — `protocol/index.ts:245-251`; the catch-all swallows typos. Drop `[key:string]: unknown` (or make it a Zod schema for boundary parsing like its neighbors).
- **[Low] `!` on genuinely-partial registry/graph lookups** — `workspace-store.ts:278` `this.def(fromId)!` (returns `NodeDef|null`), `body-dock.tsx:50` `getPlugin(pluginId)!` (returns `|undefined`); ids come from persisted JSON. Narrow with early return/throw. (The `WorkspaceCanvas.tsx:316` `getAttribute(...)!` is safe — produced by `closest("[data-nd-node]")` — leave it.)

### TanStack / caching
- **[Med] `columns` prop unmemoized at both DataTable call sites; annotations churn it** — `TerminalTable.tsx:63`, `TablePluginView.tsx:38`. `createAnnotationColumn`/`writeAnnotationByPredicate` → `refreshMetadata()` → `invalidateQueries` → fresh `obs_columns` ref → rebuilds `tableColumns`/`fetchPage`/`ensureRange` → re-fires scroll fetch. Scatter path already guards this (`useScatterColorState.ts:51`). Memoize by `metadata.obs_columns`.
- **[Med] useTableQuery hand-rolls a page cache QueryClient already provides** — `useTableQuery.ts:52-156` (Map + pending Set + manual LRU + `forceUpdate`). Replace with `useInfiniteQuery`/`useQueries` keyed by `['table-page', table, filterKey, sortKey, pageIndex]`; query owns dedup/staleness/eviction/cancellation. At minimum document why it's manual.
- **[Med] Crop blob-URL subscriber duplicated + revokes ALL `['crop']` on unmount** — `TrackGallery.tsx:51-74`, `GalleryPane.tsx:49-68`. GalleryPane is also a standalone plugin, so two consumers over the shared `['crop', …]` namespace can co-exist; unmount revoke-all can blank a still-mounted consumer. One app-level `QueryCache.subscribe` in QueryClient setup; delete the per-component blocks. (C7)
- **[Low] Mod+J/Mod+B hotkeys fire while typing** — `PanelHotkeys.tsx:11-12`; `@tanstack/hotkeys` defaults `ignoreInputs:false` for Ctrl/Meta. Real text inputs exist in the annotate/collections flows this branch adds. Pass `{ ignoreInputs: true, preventDefault: true }`.
- **[Low] DataTable `ColumnDef.cell` is dead; body cells re-implement formatting inline** — `DataTable.tsx:99-112` (defined) vs `294-319` (body bypasses `flexRender`); same formatter a 3rd time at `37-43`. Extract one `formatCell()` or drop the unused `cell`.
- **[Low] DataTable auto-size reset effect has `[]` deps** — `DataTable.tsx:139-141`; `autoSizedRef` never re-fits when columns change (directly relevant: annotations add columns at runtime). Change deps to `[columnNames]`.
- **[Low] `useTableQuery` SQL built by string interpolation; `sort.column` injected** — `useTableQuery.ts:113/130/203-209`. Factor WHERE+ORDER BY into one shared helper (count/page/findRow can't diverge); assert `sort.column ∈ columns` before interpolation.
- **[Low] `useGalleryChannels`: fresh `[]` literal + per-render `JSON.stringify`** — `useGalleryChannels.ts:34/59`. Hoist `EMPTY_CHANNELS` const; wrap `liveHash` in `useMemo([liveChannels])`.

### Accessibility & Web Interface Guidelines
- **[High] No keyboard path to connect/cut/resize/move nodes** — `WorkspaceCanvas.tsx:227` (connect = Handle drag), `KnifeLayer.tsx:73-98` (cut), `nd-resize-grips.tsx` (resize), node move = drag. (Tidy/flags/up-level/Escape *are* keybound.) Add Enter/Space connect menu, Backspace/Delete edge removal via `onEdgesChange`, arrow-key nudge, keyboard route into the Add palette.
- **[High] Window Tab handler `preventDefault`s every Tab** — `WorkspaceCanvas.tsx:349-354`, disabling focus traversal globally. Bind Add to a non-Tab key (A / reuse Cmd+K); remove the Tab `preventDefault`.
- **[High] Icon-only ScatterToolbar buttons have no accessible name** — `ScatterToolbar.tsx:315/329/368/383/394/418/435` (only Collections@349 sets `aria-label`). HoverTip text is not propagated to ARIA. Add `aria-label` to each. (C5)
- **[High] AddNodeMenu has no menu semantics / focus management / in-menu keys** — `AddNodeMenu.tsx:29-56`. Plain `<div>`, focus never enters it, no arrow/Escape. Rebuild on the base-ui Menu/`command.tsx` primitive (or add `role=menu`/`menuitem`, autofocus, Up/Down/Home/End/Escape, return-focus).
- **[Med] Engine/selection/knife status is visual-only** — `WorkspaceShell.tsx:127-130`, `WorkspaceCanvas.tsx:450-462`, `KnifeLayer.tsx:153-155`. Wrap volatile status in `role="status" aria-live="polite"`.
- **[Med] Dense canvas controls 11-15px — below 24px** — `nd-icon-button.tsx:27-30`, `NdHandle.tsx:45-46`, `nd-port.tsx:75`, `nd-resize-grips.tsx:34`. Enlarge hit area to ≥24px. (C9)
- **[Med] Nd icon controls expose name only via `title=`** — `nd-icon-button.tsx:66-69`, `nd-port.tsx:74`, `NdHandle.tsx:44`. Add `aria-label={title}`. (C5)
- **[Low] Port/wire type & connection legality by color alone** — `nd-port.tsx:23-27`, `NdHandle.tsx:23-37`, `K1Cursor.tsx:69-74`. Surface the existing kind label on hover/selection; pair the legality glow with a non-color cue.
- **[Low] `cursor:none` + rAF lerp ignores reduced-motion** — `WorkspaceCanvas.tsx:378`, `K1Cursor.tsx:123-130`. Snap to pointer (or restore system cursor) under reduced-motion; honor OS cursor size/contrast. (C8)
- *(Dropped on verification: Collections "non-modal Sheet" — it renders via SlidePanel with no overlay and the non-modal behavior is intentional/documented.)*

### Visual hierarchy & design system
- **[Med] ~6 one-off arbitrary sub-12px sizes in `nd/*`** — `nd-node-frame.tsx:164/172/188/191/197`, `nd-icon-button.tsx:27-28`, `nd-primitives.tsx:83`. Collapse to `text-2xs`/`text-3xs`; add one named token if sub-10px is genuinely needed. (C3)
- **[Med] `border-white/10|20` swatch rings vanish in light mode** — `SaveCollectionForm.tsx:176`, `CollectionRow.tsx:78`, `ActiveCollectionCallout.tsx:38`, `oklch-color-picker.tsx:16`. Light mode ships (`BottomDock.tsx:393-400`). `ui/README.md:107` names this anti-pattern. Use `border-glass-border`/`border-border-subtle`.
- **[Med] SaveCollectionForm ships a private Tailwind-400 rainbow palette** — `SaveCollectionForm.tsx:22-30`, divorced from the base-hue token system and the ochre library (`CategoricalPaletteGrid` already curates palettes). Source presets from ochre or hold to the app's chroma/lightness band.
- **[Med] Node cook-state LED distinguishes clean/dirty/error by hue alone** — `nd-primitives.tsx:19-30`; clean=green/dirty=amber/error=red separated only on the red-green axis. Reuse the existing hollow-dot/ring vocabulary (`CategoricalLegend.tsx:95-99/125`) to add a shape channel.
- **[Low] A few ambient HUD metrics near the dark contrast floor** — `BottomDock.tsx:336` (fps `text-muted-foreground/75`), legend min/max labels `/70`. Drop the opacity multiplier on static metrics; leave hover-brightening controls and the decorative bullet.
- **[Low] Flat CTA hierarchy in SaveCollectionForm** — `SaveCollectionForm.tsx:259-265`; Save and Cancel same size. Give Save `size=lg` (the ladder exists).
- **[Low] 3 raw-CSS pixel radii bypass the radius ramp** — `app.css:296/308/500`. Route through `var(--radius-sm)`; pick one default control radius.

### Tailwind system & layout
- *(C4 dual-vocabulary, C3 arbitrary sizes, C6 glass/small-button duplication covered in cross-cutting.)*
- **[Med] Documented z-index scale bypassed by raw `z-[N]`** — `node-extras.tsx:53/63/116/124/139/340`, `NdGraphNode.tsx:336`, `NdWireEdge.tsx:91`, `StagePane.tsx:222`, `WorkspaceShell.tsx:46` (raw `z-[90]`). Only `z-float`/`z-popover` are used. Fold canvas chrome into the named scale or add `--z-node/--z-edge/--z-handle`.
- **[Low] Hardcoded hex in node-extras** — `node-extras.tsx:24` `#2dd4bf` + on-color text `#06201d`/`#0c0c12`. A sibling typed-wire palette exists (`--color-wire-pred/-sel/-focus`). Add `--color-wire-feedback`.
- **[Low] `backdrop-blur-glass` utility generated but never used** — three competing syntaxes coexist. Adopt `backdrop-blur-glass` (no `app.css` change needed). (C6)

### Dashboard & layout UX
- **[High] Canvas node counts have no error state** — `node-counts.ts:88-92` `catch{return}`; `TelemetryState` has no error field (`workspace-store.ts:129`). Sibling `WranglePane.tsx:114-117` shows `✗ {error.reason}`. Thread a failed flag through `useNodeCount` → distinct affordance in CountBody + header chip.
- **[High] Keyboard grammar exposed only via one truncating hint line; cursor hidden; no empty state** — `WorkspaceShell.tsx:167-168` (hint in a `min-w-0` column), `WorkspaceCanvas.tsx:378` (`cursor:none`), `seedWorkspace` always seeds 6 nodes (`workspace-store.ts:994-1007`). Add a `?` shortcuts overlay (Hotkeys already a dep) + a visible palette '+' button; reconsider `cursor:none`. (overlaps C8)
- **[Med] Built-in node bodies have no error boundary; plugin bodies do** — `NdGraphNode.tsx:154-203` render inline vs `body-dock.tsx:170-184` (PanelErrorBoundary+Suspense). Wrap the built-in body IIFE in the same boundary.
- **[Med] Two parallel shells with divergent action vocabularies** — `App.tsx:63-69` (Dockview vs node workbench behind `#/graph`). Decide the canonical shell or unify the "open a view" vocabulary.
- **[Med] Destructive/spawn affordances take 3 shapes** — `StagePane.tsx:253-260` (raw ✕), `NdGraphNode.tsx:318-325` (`NdIconButton close`), `node-extras.tsx:279-293` (bordered "unbind" pill). Standardize on `NdIconButton` (add a danger tone) + one spawn chip.
- **[Low] Raw native `<select>`/`<input>` in node bodies** — `node-extras.tsx:159-171/240-246`. Wrap shared `NdSelect`/`NdInput`.
- **[Low] StagePane reconciles via double `JSON.stringify` in a deps-less effect** — `StagePane.tsx:374-377`. Move reconcile into `useMemo([stageTree, stagedIds])`, structural compare, scope the persist effect.
- **[Low] Three inconsistent loading strings, no skeleton** — `DashboardProvider.tsx:286`, `plugin-mount.tsx:45`, `body-dock.tsx:176`. Standardize + skeleton the app-shell metadata load.

### WebGPU / TypeGPU
- **[High] No device-loss / uncaptured-error handling** — `device-manager.ts:24-70`; `device.lost` never read, no `onuncapturederror`. Recovery plumbing exists (`device-broker.ts` releaseFor/release, `ScatterGPUHost.tsx:99/152` onGpuError). Wire `device.lost.then(...)` (distinguish `reason==='destroyed'`), route uncaptured errors to onGpuError, surface a "GPU lost — reload" overlay.
- **[Med] Pick buffer renders without re-dispatching culling** — `picking.ts:269-305` binds `culling.visibilityBuffer` but never dispatches culling; `pick()` runs synchronously when dirty (`333-336`). After a programmatic view change + click before the next RAF, it samples stale visibility. Dispatch culling into the pick encoder first (`culling.ts:48` short-circuit makes it free when fresh).
- **[Med] Color/selection computes self-submit then defer the dependent render to next RAF** — `orchestrator.ts:175/261-287`, `selection.ts:159/167`: bare `dispatchThreads` (no `.with(encoder)`) → own submit, then `requestRender()` defers render. Costs a doubled submit + one-frame visual lag. Accept the orchestrator encoder like `compositor.dispatchIfDirty`/`culling.dispatchCulling` already do. (Not an ordering hazard — same queue is in-order.)
- **[Low] Pick bind-group/vertex layout is a hand-maintained mirror of buffers.ts+pipeline.ts** — `picking.ts:95-121/129-163`, kept in sync by comment only (`picking-shaders.ts:20-33`, `buffers.ts:34-37`). A reorder silently corrupts picking. Drive both from one `SCATTER_UNIFORM_ORDER`/`SCATTER_VERTEX_SLOTS` source, or add a DEV assertion.
- **[Low] Selection readback drops the on-release request if a throttled one is in flight + full main-thread scan** — `selection.ts:117-149`: `if (isReadingBack) return;` with no trailing re-run; O(n) `indices[]` build over all (455K+) points. Add a pending flag re-run in `.finally`; GPU-reduce the count, build indices lazily.
- **[Low] Color-pack kernel divides by `paletteLen` with no zero guard** — `orchestrator.ts:148/157/175`. Currently unreachable (both `ScatterView.tsx:340/380` guard `colors.length>0`), so latent. Clamp in-shader `std.max(numCats, 1u)` as defense-in-depth.

### Code health (unused / duplication / complexity)
- **[High] `NdGraphNodeInner` complexity hotspot** — `NdGraphNode.tsx:84` (cyclomatic 64, cognitive 104, CRAP 4160): ~20 back-to-back selectors + nested LED ternary + inline body switch. Decompose into `useNodeFlags/useNodeTelemetry/useNodeFormState`, extract LED/badge helpers, push special-cases onto `NODE_DEFS`. (overlaps C1)
- **[Med] Var-picker machinery duplicated** — `ColorSourcePicker.tsx:75-96` vs `ModalityColorPicker.tsx:100-126`, near-character-identical incl. two materialization/layer-validity effects that must stay in sync. Extract `useVarColorSourcePicker({modality})`.
- **[Med] Dead constants in `lib/platform.ts`** — `IS_MAC`/`ALT_KEY`/`SHIFT_KEY` (only `MOD_KEY` used). Delete `ALT_KEY`/`SHIFT_KEY`; make `IS_MAC` module-local.
- **[Med] Orphaned `POINT_RADIUS`** — `scatter-gpu/constants.ts:1` (superseded by `PointRadiusStore`). Delete that line only. (Do NOT delete `POINT_RADIUS_DEFAULT` or the file — `MAX_POLYGON_VERTS`/`PALETTE`/`QUAD_VERTS` are live.)
- **[Med] Dead `ViewModeToggle` + `ZRangeSlider` + unused `ViewMode`/`ViewerState` re-exports** — `components/viewer/index.ts:10/15`. Delete the components/barrel lines. (`ChannelDef` is live via direct import — leave it.)
- **[Med] Dead `useHost`/`defineExtension` (intentional SDK scaffolding)** — `host-context.tsx:40`, `sdk.ts:93`. Mark `/** @expected-unused */` if the SDK ships here, else delete. (`HostInit`/`HostHandle` are live — leave them.)
- **[Low] Unused bus factory exports + dead `listByKind`** — `core/buses/index.ts:7-11` (consumers use the singletons), `registry.ts:69`. De-export the factories; delete `listByKind` (keep `listPlugins` — used internally); `createDeviceBroker` is conscious scaffolding.
- **[Low] Gallery/crop blob-URL + focus-resolution duplication** — `GalleryPane.tsx:48-68`, `CropViewer.tsx:25-32` (partly intentional per "Mirrors" comments). Lift `useCropBlobUrlGc()`/`useScopedHighlight()`. (C7)
- **[Low] Oversized renderer functions** — `orchestrator.ts:33` (~620L), `ScatterView.tsx:74` (~550L), `selection.ts:12` (~445L), `useScatterInteraction.ts:31` (~435L). Mostly linear setup; split into named sub-factories. Slow refactor.
- **[Low] fallow false-positive to silence** — `prqlLanguage` (`prql-lang.ts:133`) is loaded via dynamic `import("./prql-lang")` (`PrqlEditor.tsx:59`). Add `.fallowrc.json` `dynamicallyLoaded`/`publicPackages` (ochre barrels) so real dead code stands out. Do NOT delete it.

## 4. Needs human eyes / not covered by static review

- **Runtime GPU device-loss recovery** (WebGPU 1): the *handler* is reviewable, but whether reacquire+rebuild actually restores all panels needs a real GPU + forced context loss (Chrome devtools "lose context" / driver TDR).
- **Color-vision and contrast judgments** (Visual 4/5, A11y 8): the LED hue-only and color-only port encodings need a real contrast/CVD check in both themes; the "ambient metric near the floor" calls need a measured 4.5:1 spot-check, not eyeballing.
- **First-run discoverability of the canvas grammar** (Dashboard 2): whether a new user can find connect/cut/tidy without the hint line is a usability-test question, not a code question.
- **Selection-readback overlap on release** (WebGPU 5): the dropped-request window is plausible from the code but its real frequency/impact depends on dataset size + drag cadence — needs profiling on the 455K-point datasets.
- **Visual weight of the type-scale collapse** (Visual 1, C3): collapsing to named rungs is mechanically safe, but whether the resulting node header still reads with the intended hierarchy is a design-judgment call.
- **Whether the two shells should both survive** (Dashboard 4): a product decision, not a static-analysis one.
- **The deferred SDK scaffolding** (`defineExtension`/`createDeviceBroker`/`useHost`): keep-vs-cut depends on the plugin-architecture roadmap; static review can only flag, not decide.
