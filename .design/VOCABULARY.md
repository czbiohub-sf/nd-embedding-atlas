# Workspace vocabulary — node era

> Shared language for the node workflow system. Names here are binding for
> design conversations and code identifiers; update this document when a term
> changes. Companion to `NODE-WORKFLOW-BRIEF.md`.

## Surfaces

- **Workspace** — the whole frame: Top Bar, Stage, Canvas, Status Bar. One per
  dataset session.
- **Canvas** — the single infinite pan/zoom surface where the graph lives.
  It is never duplicated and never hidden — only **re-disposed**:
  - **Strip** — canvas docked at the bottom edge, typically at chip zoom
    (the "Houdini corner" disposition).
  - **Full canvas** — canvas expanded across the workspace
    (the "views live on the canvas" disposition).
  - Moving between dispositions is a camera + geometry animation, not a mode
    switch. Verbs: **expand / collapse the wiring**.
- **Stage** — the tiled area that grants node bodies working real estate,
  smart-organized (interactive views get the big slot). A **tile** is a
  *projection of a node*, not a panel: it carries the node id (`◆ scatA`)
  and disappears when the body is pulled back to the canvas.

## Graph objects

- **Node** — persistent identity in the graph document. Kinds:
  **source · transform · view · selection**.
- **Body** — a node's working UI (point cloud, table, Idetik viewer, filter
  distribution). Exactly **one live body per node**, projected to canvas or
  stage. Bodies **reparent, never remount** — live state (cameras, GPU lease)
  survives the move.
- **Wire** — explicit dataflow between ports.
  - **Pull wire** (periwinkle) — carries a predicate; cooked on demand,
    cache-aware, halts at clean nodes.
  - **Push wire** (amber) — carries a user-driven emission (lasso, row
    highlight); flows when the user acts, not when the engine pulls.
- **Port** — input (hollow ring) / output (filled dot). Inputs own the
  **fan-in operator** chip (`AND` / `OR` / `A−B`), mounted on the port.
- **Selection node (◇)** — a frozen row-set stamped `@ epoch N`. The
  push→pull converter: amber in, periwinkle out. Created by **freeze**;
  the branch point for spawned views.

## Node presentation (zoom-semantic)

- **Chip** — pill: LED · name · count. For topology reading.
- **Card** — config controls or thumbnail. Working at arm's length.
- **Full body** — the live body embedded on the canvas.

Render state = *f(canvas zoom, placement)*. Placement caps it: a staged
node never exceeds card on the canvas (it shows `body on stage ◆`).

## Placement

- **Placement** — where a node's body materializes: **embedded** (canvas)
  or **staged** (stage tile).
- **Pin (⇡) / pull (⇣)** — explicit placement moves, animated by the
  **relocation ghost** (FLIP).
- **Default placement** resolves **by mode**: strip → staged,
  full canvas → embedded. Explicit pins override and persist.
- Views are stageable by default. **Transforms are pin-only** — never staged
  automatically, but staging one earns it a large scrubbable body (e.g. the
  threshold filter's full-width distribution). Sources, count, and selection
  nodes are canvas-only.

## State

- **Config** — serializable params behind the **gear (⚙)**: channel stack,
  blend mode, color-by, palette, gallery columns. Saved with the graph
  document. Editing config marks the node **dirty** and recooks downstream.
- **Live state** — cameras, scroll positions, z/t scrubbing, claiming.
  Never recooks, never appears in the gear, survives reparenting.
- **Node flags** (Houdini lineage) — per-node toggles, surfaced as header
  icon buttons and keyboard flags on the selected node:
  - **bypass (`b`)** — transforms/subnets only: input passes through
    uncooked. Treatment: amber hazard stripes, struck-through label,
    content at 45%, LED inactive, and a bright periwinkle **jumper** drawn
    in-port → out-port showing the pass-through. Counts downstream update
    as if the node weren't there.
  - **display off (`d`)** — views only: the display flag drops, the branch
    is never cooked. Treatment: body dims + desaturates, `display off ·
    not cooking` badge, LED inactive — on the canvas body and stage tile
    alike.
- **Cook lifecycle** — `clean` (cached) → `dirty` (awaiting pull) →
  `cooking` → clean; `display-inactive` branches are never cooked.
  **Epoch** — monotonic edit counter, surfaced as telemetry.
- **Claiming** — an embedded body taking pointer ownership (halo + canvas
  dim + hint bar). `esc` or an outside click releases. Stage tiles never
  claim — they own their rectangle outright.

## Verbs

| verb | gesture | effect |
|---|---|---|
| expand / collapse | ⛶ · ⇧F · mode toggle | re-dispose canvas strip ↔ full |
| fit | fit button | camera to graph bounds |
| pin / pull | ⇡ · ⇣ | move a body stage ↔ canvas |
| claim / release | click body · esc | pointer ownership of an embedded body |
| lasso / re-lasso | drag in scatter · ◌ | new live selection on the amber port |
| freeze | ⊕ | reify the live lasso → Selection node |
| spawn | + table · + scatter · + gallery | new view wired from a Selection |
| bypass | b · ⊘ flag button | transform passes input through uncooked |
| display off | d · ⏻ flag button | park a view; branch never cooks |
| cook | any config/param edit | dirty → pull → recook downstream |

## Viewer modes (settled)

- **Gallery** — set-consuming: predicate/row-set in → grid of static
  cropped webp/png images. Config: columns, sort.
- **Idetik** — focus-consuming: a single obs/FOV in → live Idetik render
  with pan/zoom on all axes. z/t scrubbing is live state; the
  channel stack (color, on/off, blend) is config.

These are two node types, not modes of one node — their input semantics
differ, and the graph should show that.

## Open questions (naming debt)

1. **highlight vs selection** — table→FOV highlight and scatter lasso are
   both amber today. One concept ("focus") or two port kinds?
2. **freeze semantics** — re-freeze re-stamps the existing Selection node;
   alternative: every freeze mints a new node (a selection history).
3. **"Stage" vs the legacy "Dashboard"** — does the docked Dockview surface
   become "a saved stage layout"?
4. **claim affordance** — should hover preview the claim before the
   commit-click?
