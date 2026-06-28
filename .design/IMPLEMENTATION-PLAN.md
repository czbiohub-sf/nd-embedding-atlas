# Node Workspace — Implementation Plan

> Maps the design handoff (`design_handoff_node_workspace/README.md`, v3) onto
> this repo. VOCABULARY.md terms are binding. Prototype = visual ground truth;
> tokens come from `app.css`/`DESIGN.md`. Sequenced as the README's 7
> milestones. Conflicts between repo patterns and the design are flagged
> inline as **C1…C11** and resolved (not silently chosen) — see the Conflict
> Register at the end.

## Ground truth (current repo state, branch `feat/node-graph-tracer`)

- `core/graph/engine.ts` — GraphEngine: push-dirty / pull-cook, epoch +
  AbortController, `canConnect` (DAG-only DFS), `registerSink`, fan-in AND by
  `toPort`. Value type: `Predicate = string | null`. **No port kinds** — kind
  checking is a canvas concern.
- `core/graph/GraphCanvas.tsx` — xyflow `ReactFlow`, 4 custom node types,
  hardcoded 5-node rig, default pan/zoom, `isValidConnection → engine.canConnect`.
- `core/graph/graph-nodes.tsx` — `PluginViewNodeBody`: `use(loadPluginModule)`,
  host built once in `useState`, **`dispose()` tied to component unmount**,
  `registerSink → per-node Selection.update`.
- `core/plugin/types.ts` — `PortKind = "selection" | "predicate" | "rowset"`,
  `PluginMeta.inputs/outputs: PluginPort[]`, capabilities, placement.
- `core/host/use-dashboard-host-shim.ts` — view-host factory (coordinator,
  brushSelection, buses, deviceBroker). GPU lease memoized on host; released
  only in `host.dispose()`.
- Buses are global broadcasts (SelectionBus → shared crossfilter,
  BroadcastBus rowsets, HighlightBus single-id). The graph overlays them; it
  does not yet replace them.
- Dockview coupling isolated to `layout-host.ts` + `DockviewShell.tsx`
  (`COMPONENTS` map, `ndea_layout_v3` persistence).
- Entry: `#/graph` hash toggle inside `DashboardProvider` (App.tsx:36-44).

## Architecture decisions (the four hard constraints, realized)

### 1. One graph document, projected

New `core/workspace/workspace-store.ts` (TanStack Store) is the single graph
document: nodes `{ id, pluginId, kind, label, parent?, flags, stamp? }`,
layout `{ position, bodySize?, formOverride?, formLocked }`, placement
(`explicit` pins), edges `{ id, from, to, toPort, kind }`, `stageTree`,
`graphPath`, disposition (`strip | full`). GraphEngine remains the cook
authority; the store is the topology+presentation authority and mirrors every
`connect/disconnect/addNode/removeNode` into the engine. Canvas disposition
and per-node placement are fields on this one document — there is no mode
switch anywhere; `WorkspaceShell` animates pane rects + camera (420 ms,
`cubic-bezier(.3,.8,.3,1)`) on disposition change with a single
always-mounted `ReactFlow` (resize observed, `setViewport({duration})` for
the camera leg).

### 2. One live body per node — reparent, never remount

**Mechanism: stable DOM dock + socket adoption** (not portal-container
swapping — React recreates portal children when the container prop changes).

- `core/workspace/body-dock.tsx`:
  - `WorkspaceBodies` — one stable component at workspace root. For every
    node whose plugin has a body, it renders a `BodyOwner` keyed by node id.
  - `BodyOwner` — owns the `PluginHost` (the `useState(() => makeHost(...))`
    + `dispose-on-unmount` pattern **moves here from `PluginViewNodeBody`**,
    keyed by *node identity*). Renders the plugin Component via
    `createPortal` into a per-node dock element
    (`document.createElement("div")`, created once, never re-created).
  - `BodySocket` — rendered by both the canvas node (full form) and the
    stage tile; a ref callback `appendChild`s the dock element into itself
    on mount/placement change. Moving a DOM node preserves canvas/WebGPU
    context — cameras and device leases survive pin/pull by construction.
  - `HostProvider` wraps inside `BodyOwner`, so `useHost()` /
    `GpuDeviceProvider` travel with the React tree (context follows the
    React tree, not the DOM tree).
- FLIP relocation ghost (`FlipGhost`, ported from `proto-canvas.jsx`)
  animates `getBoundingClientRect()` from→to over the move; the real body is
  opacity-0 during the ghost flight (`flipHide` in the store).
- **C4**: `graph-nodes.tsx`'s `PluginViewNodeBody` is refactored away; the
  xyflow node becomes a *socket*, not an owner.

### 3. Typed ports — descriptor layer

- **C1 (vocabulary)**: `PortKind` is renamed to the binding design trio:
  `"pred" | "sel" | "focus"`. Mapping: today's `"selection"` (a Mosaic
  Selection consuming a pulled predicate) **is the design's `pred`**;
  `"predicate"` outputs also → `pred`; `"rowset"` → `sel`; `focus` is new.
  Touches: `core/plugin/types.ts`, 6 plugin descriptors in
  `src/frontend/plugins/*/index.ts`, `filterPort()` in `graph-nodes.tsx`.
  Done in M2 as a mechanical rename + the new kind.
- Kind compatibility + no-duplicate + DAG check compose in the canvas's
  `isValidConnection` (engine `canConnect` stays kind-agnostic — it already
  owns cycles; kinds resolve from the registry via Handle ids exactly as the
  explorer mapped at `GraphCanvas.tsx:194`).
- `stageable` / `pin-only` / `canvas-only` become plugin descriptor flags —
  **C8**: extend `PluginMeta.placement` with
  `stage?: "stageable" | "pin-only" | "canvas-only"` rather than minting a
  parallel flag namespace.

### 4. Config vs live state = the serialization boundary

- Gear popover edits go through `host.patchConfig` → mark node dirty in the
  engine (epoch bump, recook). Config lives in the graph document.
- Cameras, z/t scrub, scroll, claiming: live state held inside the plugin
  instance / `BodyOwner` closure — survives reparenting because the instance
  never remounts; never serialized; never recooks. z/t sliders call
  `patchConfig`-equivalents flagged `liveState: true` (no dirty), matching
  `proto-node.jsx`'s `patchSettings(id, p, { liveState: true })`.

### Push wires (sel / focus) — **C2**

The engine is pull-only and carries `Predicate`. `sel`/`focus` are push.
Resolution: `core/workspace/push-router.ts` — an edge-scoped router beside
the engine. An out-port emission (lasso rowset, table row focus) is delivered
only along matching `sel`/`focus` edges to target node inputs. The
◇ Selection node is the push→pull converter: freeze stamps
`{ rowIds, epoch }` and its engine cook emits a stable predicate
(`obs_id IN (…)` for small sets; token temp-table via the existing
`makeToken` cache-buster machinery for large ones). Long-term option
(generalize engine to `PortValue = { kind, payload }`) is deliberately
deferred — flagged in the register, not needed for v3 parity.

**C5/C6 (global buses vs explicit edges)**: today a canvas scatter's lasso
still broadcasts via SelectionBus to *every* view, and the image viewer reads
the global HighlightBus. In the workspace, canvas/stage-mounted plugins get a
host variant whose `publishRowSet`/highlight path routes to the push-router
instead of the global buses (precedent: `makeTransformHost` already builds
inert-bus hosts). The Dockview dashboard keeps global-bus semantics
untouched. This is the "global buses vs explicit edges" theme from the
node-graph adjustments ledger — resolved per-surface, not globally.

## New module map

```text
src/frontend/components/nd/            # the standardized component layer
  nd-node-frame.tsx                    # NdNodeFrame — chip/card/full, 26px header, footer
  nd-port.tsx                          # NdPort — 11px typed glyph (circle/diamond/square)
  nd-icon-button.tsx                   # NdIconButton + ND_ICONS 10×10 registry
  nd-form-controls.tsx                 # form cycle + lock
  nd-resize-grips.tsx                  # 4-corner hotspots, SE glyph
  nd-breadcrumb.tsx                    # shadcn anatomy, mono 9.5px
  nd-telemetry.tsx                     # NdLed / NdChip / NdHud (Bracketed already exists — reuse)
  nd-resolve-form.ts                   # ndResolveForm(base, override, locked, staged, canFull)

src/frontend/core/workspace/
  WorkspaceShell.tsx                   # frame: panes, seam animation, status bar
  workspace-store.ts                   # the graph document (see §1)
  constants.ts                         # chipMax .55 · fullMin 1.08 · hysteresis .04 · 420/220/200ms (Tweaks ship as constants)
  placement.ts                         # placementOf(), pin/pull, default-by-mode
  body-dock.tsx                        # WorkspaceBodies / BodyOwner / BodySocket (§2)
  push-router.ts                       # sel/focus edge-scoped delivery (C2)
  telemetry.ts                         # engine cook events → LED states, cook ms, epoch
  stage/
    split-tree.ts                      # pure tree helpers (port of proto-stage) + unit tests
    StagePane.tsx / StageTile.tsx / StageSash.tsx / StageEmptySlot.tsx
  canvas/
    WorkspaceCanvas.tsx                # ReactFlow config + input grammar wiring
    NdGraphNode.tsx                    # xyflow custom node hosting NdNodeFrame (3 forms)
    NdWireEdge.tsx                     # custom edge: kind colors, dash anims, ✕ chip
    wire-geometry.ts                   # bezier (ctrl = max(|dx|·.45, 24)) — shared with knife
    KnifeLayer.tsx                     # Y-drag stroke, 20-sample intersection, red marking
    AddNodeMenu.tsx                    # Tab / right-click glass palette
    WorkspaceMinimap.tsx               # styled xyflow MiniMap (glass, click-to-jump)
    K1Cursor.tsx                       # morphing-dot cursor (M7)
    tidy.ts                            # Sugiyama-lite (longest-path + barycenter)
  hud/
    StatusBar.tsx                      # 22px mono telemetry bar
    WiringHeader.tsx                   # strip-mode 26px wiring-tile header
```

`app.css` gains: `--wire-pred #8b7bf7` / `--wire-sel #f59e0b` /
`--wire-focus #38bdf8`, `.nd-led` states, `nd-wire-flow/push` keyframes,
`.nd-rs-morph` (from `prototype/tokens.css`, dark block only — repo `@theme`
stays source of truth; `prefers-reduced-motion` collapses all of it).

## Engine API additions (`core/graph/engine.ts`)

| API | For | Milestone |
|---|---|---|
| `onTelemetry(cb: (e: {node, type: "dirty"\|"cook-start"\|"cook-end", ms?, epoch}) => void)` | LEDs, wire dash, cook ms, status bar | M2 |
| `setBypass(id, on)` — cook becomes first-input passthrough, dirties downstream | bypass flag | M6 |
| (display-off = existing `unregisterSink` — no engine change) | display flag | M6 |
| nothing for hierarchy — engine stays **flat**; proxies are identity-cook transforms (**C9**) | subnets | M5 |

## Milestones

Workflow per milestone: implement → `vp run dev <infectomics yaml>` → verify
in browser (chrome-devtools MCP) → `/impeccable critique <surface>` → fix →
`vp check` + `vp test` → commit. `/impeccable audit` at the end of M7.

### M1 — tokens + NdNode component layer

- **Files**: everything under `components/nd/`, `app.css` token additions,
  `core/workspace/constants.ts`. Plus a dev-only spec route
  (`#/nd-spec` page mirroring `component-spec/spec-demos.jsx`) to exercise
  every form/state without the canvas.
- **Engine**: none.
- **Mocked**: all data in the spec route (counts, LEDs cycled by buttons).
- **Checkpoint**: `#/nd-spec` side-by-side with
  `component-spec/Node Component Spec.html` — chip/card/full at correct
  sizes, ports outside the morphing wrapper, icon registry rendering,
  form-cycle + lock behavior, reduced-motion collapse.

### M2 — canvas, wires, edit

- **Files**: `workspace-store.ts`, `canvas/` (all but K1Cursor),
  `telemetry.ts`, `push-router.ts` (skeleton: live lasso → gallery),
  PortKind rename (**C1**), `NdGraphNode` replacing the four ad-hoc node
  types, `NdWireEdge` replacing default edges, `GraphCanvas.tsx` retired
  into `WorkspaceCanvas.tsx` (route `#/graph` now mounts WorkspaceShell,
  full-canvas disposition only).
- **xyflow config**: `minZoom .1 / maxZoom 1.8`, `zoomOnDoubleClick: false`,
  `Background` dots 22px, custom `connectionLine` in kind color, edge
  `interactionWidth: 11`, `updateNodeInternals` after form morph (**C7**:
  Handles stay mounted in chip form, visually collapsed — xyflow requires
  mounted Handles for edges).
- **Render state**: global zoom bands + ±0.04 hysteresis from `useViewport`,
  per-node override via `ndResolveForm`.
- **Engine**: `onTelemetry`.
- **Real**: topology (engine connect/disconnect), predicates, cook dashes,
  epoch, transform configs (threshold filter exists as a plugin). Counts
  semi-real: per-node `COUNT(*)` under the cooked predicate, debounced,
  `…` while cooking (**perf note**: one count query per dirty node per
  cook — acceptable at this graph size, revisit if it shows in traces).
- **Mocked**: stage (absent), selection freeze (button stub), focus wires.
- **Checkpoint**: at `#/graph` — build a graph by hand from the palette
  (Tab), drag typed wires with legality glow, cut with knife, delete via
  ✕ chip, watch cook dashes + LEDs run on real engine state, zoom through
  chip→card→full with hysteresis and no boundary flapping.

### M3 — stage split-tree + placement reparenting

- **Entry spike (C3) — RESOLVED 2026-06-10: hand-rolled.** v6's additions
  (Tab Groups, Edge Groups, tab context menus, theme builder) serve
  tab-based docking; none express the stage contract (4-direction 50/50
  splits with 0.12–0.88 ratio clamps, empty slots, drag-swap-not-dock,
  26px tile anatomy without a tab strip). `renderer: 'onlyWhenVisible'` +
  onShow/onHide confirms panel DOM detach on layout ops — workable but
  flicker-risky for GPU bodies. The body-dock socket pattern makes the
  substrate non-architectural regardless. Dockview dashboard untouched;
  follow-up idea (not M3): adopt the v6 theme builder output to replace
  the hand-maintained `--dv-*` block in app.css.
- **Files**: `stage/*` (if hand-rolled: split-tree helpers with vitest unit
  tests, ported 1:1 from `proto-stage.jsx`; if Dockview: a `StageDockview`
  adapter + custom tab/groupControl chrome for the tile anatomy), `body-dock.tsx`,
  `placement.ts`, `WorkspaceShell.tsx` (strip ↔ full seam, wiring-as-tile
  header, status bar), descriptor `stage` flag (**C8**), `graph-nodes.tsx`
  body-ownership refactor (**C4**).
- **Engine**: none.
- **Real**: scatter camera + GPU lease surviving pin/pull (this is the
  acceptance test), table/gallery/viewer bodies in tiles, sash ratios,
  split-direction picker, tile drag-swap, empty slots.
- **Mocked**: nothing new.
- **Checkpoint**: pin a scatter mid-pan-zoom to the stage — camera identical
  after the move (and back); strip↔full animates panes+camera together at
  420 ms; split a tile 4 ways; sash min 56px; staged node's canvas card
  shows `body on stage ◆`. Verify no `dispose()` fired during reparent
  (devtools console + a temporary host log).

### M4 — input grammar + resizing

- **Files**: `WorkspaceCanvas.tsx` (grammar wiring), `KnifeLayer` polish,
  `tidy.ts`, `nd-resize-grips` wiring (per-form `bodySize` overrides,
  clamped 200–780×140–720, morph suppressed during drag), stage sashes
  already in M3.
- **xyflow mapping**: bare left-drag = `selectionOnDrag` (partial-touch
  mode), pan = `panOnDrag: [1]` + `panActivationKeyCode: " "`, right-click =
  `onPaneContextMenu` → palette, smart double-click (port/node → frame;
  empty → dive; zoomed-in → fit) on `onDoubleClick` with port hit-test from
  `wire-geometry`, esc chain (menu → settings → selection → claim), group
  drag = xyflow multi-selection drag, `L` tidy (selection-scoped when ≥2),
  workspace root `user-select: none`.
- **Engine**: none.
- **Checkpoint**: the PROMPT.md gauntlet — marquee, L, Y-knife, Tab,
  double-click a port, resize a full body from all four corners (top/left
  anchor opposite corner), esc chain order correct.

### M5 — hierarchy (subnets)

- **Files**: `workspace-store.ts` (parent field, level filtering,
  `parentOverride`), proxy node type (identity cook, chip-only seam markers
  ⊳/⊲), `NdBreadcrumb` wiring in WiringHeader + canvas HUD,
  collapse-into-subnet (boundary-edge rewiring through proxies, ported from
  `proto-app.jsx:collapseSelection`), enter/exit (`u`, double-click,
  breadcrumb), camera refit on level change.
- **Engine**: none (**C9** — engine stays flat; the document filters the
  visible level; closed-subnet presentation edges map to engine edges
  through the proxies).
- **Checkpoint**: marquee 2+ transforms → collapse; outer counts unchanged
  (cook equivalence); enter, edit inside, exit; breadcrumb jumps levels.

### M6 — flags + cook telemetry (HUD-prominent)

- **Files**: `telemetry.ts` complete (epoch `0142` footers + status bar,
  cook ms, telemetry toggle quiets all of it), flag visuals (bypass hazard
  stripes + struck label + periwinkle jumper; display-off dim/desaturate +
  badge on body and tile alike), `b`/`d` keys, freeze/staleness for the
  ◇ Selection node (`⚠ stale — upstream @ NNNN`, `↻ re-freeze` re-stamps —
  open Q1 stays open), spawn buttons (+table/+scatter/+gallery cascading
  +280/+40), explicit-freeze default (auto-node mode dropped or
  localStorage-gated). **Collections (C12)**: "save as collection" on the
  Selection node (existing create API; collection-backed badge), Collection
  source node in the palette (pred out, gear picks the collection, cook
  emits the activate predicate), export via the existing
  `ExportCollectionDialog` from the node header.
- **Engine**: `setBypass`; display-off via sink unregistration; counts
  ripple through bypass (passthrough cook).
- **Checkpoint**: bypass the threshold filter — downstream counts jump to
  unfiltered, jumper renders, LED inactive; `d` a gallery — branch never
  cooks; freeze a lasso, dirty upstream, see stale-amber + re-freeze.

### M7 — K1 cursor + polish

- **Files**: `K1Cursor.tsx` (portal at workspace root, canvas-only,
  rAF-lerp per axis — **C11**: no gsap dependency; color leads 70 ms, shape
  follows 60 ms delay, 9px drag-ring with emerald legality, hidden over
  UI/claimed bodies), minimap polish, pointer claiming (embedded bodies:
  halo + canvas dim + hint bar + wheel/drag → node camera; stage tiles
  never claim), `prefers-reduced-motion` sweep, z-order audit
  (wires 2 < nodes 3 < selected 5 < claimed 6 < ports 8 < chrome 10 <
  cursor 60).
- **Checkpoint**: full PROMPT.md walkthrough on real data;
  `/impeccable audit the workspace`; `vp check` + `vp test` + both built-in
  and Bun test suites green.

## Conflict register (explicit resolutions — none chosen silently)

| # | Conflict | Resolution |
|---|---|---|
| C1 | `PortKind` vocab: repo `selection/predicate/rowset` vs binding `pred/sel/focus`; repo "selection" semantically IS design "pred" | Rename in descriptor layer (M2): `selection→pred`, `predicate→pred`, `rowset→sel`, add `focus`. ~8 files, mechanical |
| C2 | Engine is pull-only, `Predicate`-typed; `sel`/`focus` are push | Edge-scoped `push-router.ts` beside engine; ◇ Selection node converts push→pull (token-table predicate). Generalizing engine to `PortValue` deferred |
| C3 | Stage vs legacy Dockview "Dashboard" (open Q2) | **Dockview-first.** Repo is already on `dockview-react ^6.4.0`. M3 opens with an evaluation spike against the v6 docs (https://dockview.dev/docs/overview/whats-new-v6): can a Gridview/branch-layout surface express the stage contract — 4-direction 50/50 splits, sash ratios, drag-swap, empty slots, our 26px tile anatomy as custom panel chrome, and (critically) panel DOM stability for the body-dock? If yes, the Stage improves our Dockview implementation (shared muscle with the legacy dashboard, free layout serialization → open Q2 converges on "saved stage layouts"). Hand-rolled split-tree (~100 LoC pure helpers) is the fallback if Dockview fights the tile anatomy or remounts panel DOM on layout ops |
| C4 | `PluginViewNodeBody` ties host `dispose()` to component unmount — fatal for reparenting | Ownership lifts to `BodyOwner` (keyed by node identity) under stable `WorkspaceBodies`; xyflow node + stage tile become sockets adopting a stable dock DOM element |
| C5 | Scatter lasso broadcasts globally via SelectionBus; design demands edge-scoped amber flow | Workspace host variant routes `publishRowSet` to push-router; Dockview surface keeps global semantics (per-surface, mirrors `makeTransformHost` precedent) |
| C6 | Image viewer reads global HighlightBus; design wants explicit focus wires | Same as C5 — viewer's workspace descriptor declares a `focus` input; the dashboard path untouched |
| C7 | xyflow needs Handles mounted for edges; chip form has no visible second port | Handles always mounted, visually collapsed at chip; `updateNodeInternals` after every form morph |
| C8 | `stageable`/`pin-only`/`canvas-only` flags vs existing `PluginPlacement` | Extend `placement` with a `stage` field — one vocabulary, no parallel flag namespace |
| C9 | Engine has no subnet concept | Engine stays flat; subnets are document-level grouping, proxies are identity-cook transforms, closed-subnet edges are presentation-only |
| C10 | Graph doc persistence (open Q4, deliberately deferred) | Store shape carries the config/live-state split now (positions, bodySize, placement, stageTree, config = serializable; cameras/claim = excluded); no serializer until the persistence decision lands |
| C11 | Prototype says "production: gsap.quickTo per axis" for K1 | No new dependency — rAF lerp matches the spec'd timings; revisit only if it measurably stutters |
| C12 | Collections (server-backed `/api/collections`, `activeSet` facet → global crossfilter, CollectionsSheet) have no place in the handoff design | Collections = persisted ◇ Selection nodes. (a) Selection node header action "save as collection" → existing create API; node becomes collection-backed (name/color badge, predicate from the activate endpoint, survives sessions). (b) New **Collection source node** in the palette (pred out; pick collection in gear) — saved collections enter graphs as explicit wires, not the global `activeSet` broadcast. (c) Export stays an action (reuse `ExportCollectionDialog` from the node header), not a node — it is a side effect, not dataflow. (d) Dashboard surface keeps CollectionsSheet + `activeSet` untouched (per-surface, as C5/C6). Lands in M6 with freeze/staleness |

## Open questions carried (not resolved here, per handoff)

1. Re-freeze re-stamps vs. selection history (M6 ships re-stamp; minting is
   an additive change).
2. Saved stage layouts vs Dockview dashboard (C3 keeps both alive).
3. Claim hover-preview before commit-click (M7 ships commit-click only).
4. Persistence/document model (C10 readies the boundary).

## Risk ranking

1. **M3 body-dock reparenting** — highest. De-risk first thing in M3 with a
   spike: scatter plugin, one dock, two sockets, toggle placement, assert
   camera + device lease survive. If DOM-move breaks something exotic in the
   scatter GPU host, fallback is lifting the WebGPU canvas itself into the
   dock element (it already renders into its own canvas).
2. **M4 grammar vs xyflow defaults** — medium; every gesture has a documented
   xyflow escape hatch (mapped above), but interaction-conflict debugging is
   fiddly.
3. **M2 count queries** — low; debounce + `…` placeholder; perf gate before
   adding per-node histograms.
4. M1/M5/M6/M7 — porting work with clear references.
