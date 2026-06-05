# Implementation Plan — Brand-Aligned Design System

> Synthesized from the planning workflow (5 workstream investigations, grounded in real file:line).
> Branch: `design/brand-foundation`. Annotate freely — phases/ordering/risks are all open to edit.

## Synthesis & phase ordering

/Users/sricharan.varra/Biohub/nd-embedding-atlas/IMPLEMENTATION-PLAN.md

Synthesized the five workstream sections into a single phased plan. Key synthesis decisions:

- **Phase ordering resolves the cross-workstream dependencies the sections flagged.** Fonts/tokens land first (everyone consumes `--font-hud`, the named rungs, and `--primary`); the bracket primitive precedes SlidePanel (which consumes it); SlidePanel + registry precede the panel migrations; Dockview removal lands after the migrations (so re-homed content has a home) but before the status-bar HUD (so both BottomDock edits don't collide); the token-collapse finish + dep sweep is the coordinated tail.

- **Deduplicated the overlaps the sections called out explicitly.** The `--font-mono` duplicate, the `accent-cyan→primary` rename, the `app.css:16` header comment, the Martian dep removal, the `text-tail` migration excluding `DockviewShell.tsx:32`, and the BottomDock/`ScatterOverlayControls` double-touch are each assigned to exactly one phase with the others cross-referenced rather than repeated.

- **Two shared-file hazards drove the worktree advice:** `app.css`/`@theme` (Phases 0/4/6) and BottomDock + `ScatterOverlayControls` (Phases 4/5). The plan serializes both and recommends Phases 4+5 share one worktree.

- **Consolidated 13 open questions** (collapsing the per-section duplicates — charts, multi-scatter, layout persistence, `font-heading`, `text-text-secondary`, density target, Geist Pixel face all appeared in multiple sections).

I verified the load-bearing references before writing: `app.css:1-110` (the font imports, dual-vocab `@theme`, dead `--control-height`/`--row-padding-y` tokens, `accent-cyan` repointed to periwinkle, `--text-2xs`/`--text-3xs` rungs) and `dockview-react ^6.4.0` at `package.json:44`, plus the layout-dir file inventory (`DockviewShell.tsx`, `BottomDock.tsx`, `ViewerPiP.tsx`, `FloatingScatterWindow.tsx`, `PanelErrorBoundary.tsx`, `panels/`). All matched the section claims, so I preserved the section-supplied line numbers (annotated `~` where the section itself gave approximate ranges).

One note: the workstream sections reference paths under `src/frontend/` (matching the current Bun-rewrite tree in AGENTS.md), not the older `src/nd_embedding_atlas/.../frontend/src/` paths in your saved MEMORY.md — I followed the sections and the live tree.

---

## Fonts — role split (DM Sans=UI prose, Geist Mono=data/IDs/table, Geist Pixel=HUD signage), revert Martian Mono, resolve font-heading.

**Build order:** No structural dependency, but sequence with siblings: (1) DOCKVIEW-removal rewrites/relocates BottomDock — apply font-hud to the surviving status bar in the same PR or after dock removal lands. (2) SKETCH-disposition (delete vs keep): if deleted, skip the SketchGallery font edits; if kept, they belong here. (3) BRACKETS-promotion turns Bk/Label into ui/ primitives that consume font-hud — define --font-hud FIRST (this workstream). Land this font workstream EARLY (tokens + imports) since density, bracket, and panel workstreams build on the corrected roles.

### Current state

app.css wires three font roles, all currently pointed at Martian Mono. Imports: DM Sans via Google CDN @import (app.css:1) and @import "@fontsource-variable/martian-mono" (app.css:5). @theme sets --font-sans: "DM Sans" (app.css:49) and --font-mono: "Martian Mono Variable", ui-monospace, monospace (app.css:50). The @theme inline block REDECLARES --font-heading: var(--font-mono) (app.css:435) and AGAIN --font-mono: "Martian Mono Variable" (app.css:436, duplicate of line 50). @layer base html @apply font-mono (app.css:536-538) makes Martian the document-wide default, so every surface not overriding font-sans/heading inherits mono. Stale header comment "DM Sans (UI) + JetBrains Mono (data)" (app.css:16) names an unused font. CSS hardcoding var(--font-mono): .time-slider .input (app.css:272) and orphan .status-bar (app.css:305, NO TSX consumer per grep). The real HUD/status bar is BottomDock.tsx (uses text-2xs/tabular-nums, inherits mono from html default; metrics readouts at BottomDock.tsx:311-333). font-heading consumed by 5 title surfaces: ui/dialog.tsx:98, ui/sheet.tsx, ui/popover.tsx, ui/alert-dialog.tsx, ExportCollectionDialog.tsx:183 — dialog/sheet TITLES render Martian today. package.json: @fontsource-variable/geist-mono ^5.2.8 (line 23, INSTALLED, family 'Geist Mono Variable', never @imported); @fontsource-variable/martian-mono ^5.2.7 (line 24, imported). The geist npm package (ships Geist Pixel) is NOT installed. SketchGallery.tsx (?sketch gate, main.tsx:18-21) hardcodes Martian in DARK_VARS/LIGHT_VARS (lines 52,72) and force-overrides .font-mono to Martian via injected style + Google link (lines 348-354).

### Proposed changes

- MONO REVERT (app.css:5): replace the martian-mono @import with @import "@fontsource-variable/geist-mono" (package installed; @import of a bare pkg resolves the . export = index.css). Family is 'Geist Mono Variable'.
- MONO TOKEN: set --font-mono to 'Geist Mono Variable', ui-monospace, monospace at BOTH sites (app.css:50 and app.css:436); both must change or the inline copy keeps Martian.
- DEDUPE (optional): remove the redundant --font-mono at app.css:436.
- PIXEL dep note: geist exports only ./font, ./font/mono, ./font/pixel etc., all next/font/local JS (peerDep next), NOT importable in Vite+Bun. Raw woff2 at node_modules/geist/dist/fonts/geist-pixel/GeistPixel-{Square,Grid,Circle,Line,Triangle}.woff2 are NOT in exports, so @import or url(geist/...) is BLOCKED. RESOLUTION: vendor the chosen woff2 into src/frontend/fonts/ and reference via relative url(); recommend NOT adding the geist dep; document SIL OFL provenance.
- PIXEL @font-face: in app.css near imports add @font-face family 'Geist Pixel', src url(./fonts/GeistPixel-Square.woff2) format woff2, font-weight 500, font-display swap. Square=legible primary export; Grid=literal pixel alternative. Single-weight 500, not variable.
- PIXEL token: add to @theme --font-hud: 'Geist Pixel', 'Geist Mono Variable', ui-monospace, monospace; Tailwind v4 auto-generates a font-hud utility from any --font-\* in @theme.
- ROLE ASSIGNMENT: (1) UI=DM Sans — change @layer base html @apply font-mono (app.css:537) to @apply font-sans; data surfaces opt INTO font-mono (~30 explicit sites already). (2) Data/IDs/table=Geist Mono via existing font-mono (no churn: DataTable.tsx:218, legends, ID spans). (3) HUD=Geist Pixel via font-hud — apply to BottomDock.tsx readouts (BottomDock.tsx:311-333, the 'sel' span) and promoted Bk/Label primitives; sparingly (bracketed counts, READY, micro uppercase labels).
- font-heading RESOLUTION: --font-heading: var(--font-mono) (app.css:435) now resolves to Geist Mono after the mono revert (no extra edit). RECOMMEND keep titles=Geist Mono to match the sketch uppercase mono signage; ALTERNATIVE set var(--font-sans) for UI-prose titles.
- CSS SURFACE FIXES: .time-slider .input (app.css:272) keeps var(--font-mono)=Geist Mono (correct). Orphan .status-bar (app.css:298-310) recommend delete as dead CSS (cleanup workstream); if kept it harmlessly becomes Geist Mono.
- HEADER COMMENT (app.css:16): change to 'DM Sans (UI prose) + Geist Mono (data/IDs/table) + Geist Pixel (HUD signage)'.
- SKETCH: in SketchGallery.tsx remove the Martian override (delete Google Martian link + injected .font-mono style, lines 348-354) and set --font-mono in DARK_VARS (line 52) + LIGHT_VARS (line 72) to 'Geist Mono Variable'; wire Bk/Label to font-hud. Moot if the cleanup workstream deletes the sketch — coordinate.

### New files

- src/frontend/fonts/GeistPixel-Square.woff2 — vendored Geist Pixel HUD face copied from node_modules/geist/dist/fonts/geist-pixel/GeistPixel-Square.woff2 (SIL OFL); referenced by the manual @font-face in app.css. Optionally GeistPixel-Grid.woff2 instead if Grid is chosen.

### Dependencies

- add: geist@^1.7.2 — OPTIONAL, only as upstream source for the vendored Geist Pixel woff2. Recommended NOT to add (exports are next/font-only, not importable in Vite+Bun); vendor the file and skip the dep.
- remove: @fontsource-variable/martian-mono — remove from package.json dependencies (line 24); not @imported after the Geist Mono revert and not referenced once the sketch override is removed.

### Risks

- Flipping html default from font-mono to font-sans (app.css:537) is high-blast-radius: surfaces relying on inherited mono (no explicit font-mono) switch to DM Sans. Mitigation: data surfaces already set font-mono explicitly, but a full screenshot pass is required pre-merge.
- geist exports map blocks deep woff2 imports; @import or url(geist/...) fails under Vite/Bun; the vendored-file path avoids this.
- Geist Pixel is decorative single-weight (500) pixel-grid; at 10-11px HUD sizes (text-3xs=10px, text-2xs=11px) it needs whole-pixel size/line-height or glyphs blur. The locked 85% density must come from base sizing, NOT a scale() transform (which smears pixel glyphs).
- Geist Pixel has limited glyph coverage; --font-hud falls back to Geist Mono for gaps but yields mixed-face rendering; keep HUD to digits, basic latin, brackets.
- The Geist Mono @import bundles many unicode subsets (same footprint as the removed Martian import) so net bundle change is roughly neutral; the DM Sans Google-CDN @import (app.css:1) stays a runtime network dep, unchanged here.
- Duplicate --font-mono (app.css:50 and 436) must BOTH change or Martian wins via the later inline block.

### Verification

- Build: vp run build succeeds and the GeistPixel @font-face url() resolves in dev (dist/frontend on disk) AND the compiled binary ($bunfs embedded); vendor the woff2 under src/frontend so Bun.build embeds it via the relative reference.
- Quality gate: vp check passes after the app.css + SketchGallery edits.
- Runtime visual: vp run dev /Users/sricharan.varra/Biohub/ome-atlas-test-data/infectomics/infectomics.yaml (backend :5055, Vite :5173); confirm (a) table/legend/ID = Geist Mono, (b) UI prose/dialog body = DM Sans, (c) BottomDock readouts = Geist Pixel, (d) dialog/sheet TITLES match the font-heading decision.
- DevTools Fonts/Network: confirm load of geist-mono woff2 + vendored GeistPixel woff2; confirm NO martian-mono request.
- Grep guard: rg -i martian src returns zero hits after the sweep (imports, tokens, package.json dep, SketchGallery overrides cleared).
- Fallback check: with font-display swap, confirm computed font-family on a BottomDock readout is actually Geist Pixel, not the Geist Mono fallback.

### Open questions

- font-heading final call: keep dialog/sheet TITLES in Geist Mono (matches sketch signage, recommended) or switch to DM Sans? Affects app.css:435 only.
- Which Geist Pixel face for HUD: Square (most legible, package default, recommended) vs Grid (literal pixel-grid, noisier at 10px)? Determines which woff2 is vendored.
- Vendor the woff2 (recommended, no importable dep) vs add the geist npm dep plus a postinstall copy? Confirm stance on committing a binary font vs a build-step copy.
- Delete the orphan .status-bar CSS rule (app.css:298-310, no TSX consumer) now or leave to the cleanup workstream?
- Confirm the html-default flip from font-mono to font-sans (app.css:537) is wanted now: required for the role split to read correctly but the highest-blast-radius single edit; may belong in a coordinated role-flip commit with a full screenshot pass.

---

## tokens-density-cleanup

**Build order:** Depends on / coordinates with two sibling workstreams. ORDER: (1) fonts workstream lands FIRST for the --font-mono repoint to Geist Mono + Geist Pixel wiring + removal of the app.css:5 martian @import — only then can THIS workstream safely remove the @fontsource-variable/martian-mono dep and fix the header comment. (2) dockview-removal workstream lands the .dv-\*/.dockview/DockviewShell deletions; THIS workstream then skips those lines (don't migrate DockviewShell.tsx:32, don't trim .dv-header-action). If ordering can't be guaranteed, this workstream's safely-independent slice = accent-cyan rename, dead-token purge (control-height/row-padding), text-tail migration (excluding DockviewShell), 85% density base trims, dual-vocab bridge Step 1 (light-mode aliasing). The dep removals + header comment + font-heading flip are the coordinated tail. Downstream: nothing depends on this; it's foundation cleanup.

### Current state

app.css (555 lines) is the single source of all design tokens, structured in tiers but carrying two parallel, fully-live color vocabularies plus dead/duplicate tokens.

DUAL VOCAB (both heavily used, neither dead):

- CUSTOM vocab defined in the @theme block (app.css:52-66): --color-base, --color-surface{,-secondary,-tertiary}, --color-elevated, --color-border-{subtle,active}, --color-text-{primary,secondary,muted}, --color-status-bar{,-border}. Generates utilities bg-base/bg-surface/text-text-muted/border-border-subtle/etc. Usage: 33 files (e.g. text-text-muted 20 files, border-border-subtle 15, bg-surface 11, text-text-secondary 10, text-text-primary 8, bg-elevated 6, bg-surface-secondary 5, bg-base 4, border-border-active 3, bg-surface-tertiary 1; bg-status-bar 0 — used only via the .status-bar CSS rule app.css:298-310).
- SHADCN vocab (app.css:492-525 :root light, :137-201 html.dark, bridged into Tailwind via @theme inline app.css:434-467): --background/--card/--muted/--foreground/--muted-foreground/--border/etc. Usage is DOMINANT: text-muted-foreground 49 files, text-foreground 35, border-border 31, bg-muted 27, bg-card 7, bg-background 6.
- BRIDGE already exists: html.dark (app.css:141-156) points the custom --color-\* tokens at the shadcn preset vars (--color-base:var(--background), --color-surface:var(--card), --color-text-primary:var(--foreground), etc.) so the two are kept in sync in dark mode only. Light mode (app.css:52-66) hardcodes the custom values independently of the preset :root (app.css:492-525) — so the bridge is one-directional and light-mode values can drift.

DENSITY: body sets font-size:13px, line-height:1.4 (app.css:217-218). Named rungs --text-2xs (0.6875rem/11px, app.css:99) and --text-3xs (0.625rem/10px, app.css:100) already exist and text-2xs/text-3xs are in active use across ~24 files. Tailwind --text-xs is 12px. No transform-based scaling exists today; "85% density" must come from real value trims.

DEAD TOKENS (confirmed): --control-height-{sm,md,lg} (app.css:106-108) and --row-padding-y-{sm,md,lg} (app.css:109-111) are defined + documented in ui/README.md:64-65 but consumed nowhere in .ts/.tsx. The README claims SliderRow/IconButton/ControlStrip "select a density rung" but slider-row.tsx etc. use text-2xs/3xs, not these.

DUPLICATE: --font-mono is defined twice — @theme (app.css:50) and @theme inline (app.css:436), both "Martian Mono Variable". --font-heading:var(--font-mono) (app.css:435) makes dialog/sheet/popover/alert-dialog TITLES render in mono (font-heading call sites: dialog.tsx:98, sheet.tsx:130, popover.tsx:62, alert-dialog.tsx:79, ExportCollectionDialog.tsx:183).

ACCENT-CYAN: --color-accent-cyan defined at app.css:69-71 (already repointed to periwinkle oklch(0.554 0.236 281)). Call sites: app.css:287 (.time-slider accent-color), RangeSlider.tsx:23 & :36 (accent-accent-cyan), ViewModeToggle.tsx:15 & :23 (bg-accent-cyan/20 text-accent-cyan, ×2 each line). README.md:87 documents FilterBadge "accent-cyan".

STALE COMMENT: app.css:16 says "DM Sans (UI) + JetBrains Mono (data)" — neither JetBrains nor the actual Martian Mono. Header is wrong on two counts.

FONTS/DEPS: @fontsource-variable/martian-mono imported app.css:5, dep package.json:24. @fontsource-variable/geist-mono installed (package.json:23) but NOT imported anywhere; its family name is "Geist Mono Variable". The 'geist' npm package (Geist Pixel) is NOT installed. dockview-react dep at package.json:44 (removed by the dockview workstream, not this one).

ARBITRARY TEXT TAIL: text-[9px]/[10px]/[11px] across 23 production files (sketches excluded): ui 7 files (tabs.tsx:22, sheet.tsx:130 is 13px+, sheet.tsx:140, field.tsx:41/71/84, oklch-color-picker.tsx:32/74/81, dimension-badge.tsx:18, hover-tip.tsx:29), collections 6 (CollectionsSheetBody:23, ActiveCollectionCallout:43, CollectionRow:102, SaveCollectionForm:247/252, CollectionsList:115, ExportCollectionDialog:193/196/242/248/270/275/276/279), viewer 4 (ChannelControls 74/108/115/151/162/167, VolumeControls 114/123, ViewerErrorBoundary:23, ViewModeToggle:11), table 2 (TrackPane 78/88/108/122, TrackGalleryCard 51/62/65/66), plus charts/ChartPanelList:30, toolbar/ExportDialog 123/134/165, layout/DockviewShell:32. Edge cases: field.tsx:41/71 use text-[10px]/relaxed (line-height modifier), sheet.tsx:130 uses text-[13px] (a title, maps to text-sm not a micro rung), TrackPane:108/122 are text-[10px] but semantically HUD readouts.

### Proposed changes

- DUAL-VOCAB COLLAPSE — pick SHADCN as the single source of truth (it is 2-3x more used: 49/35/31/27 files vs 20/15/11). Do NOT delete the custom utilities wholesale (33 files use them); instead make the custom tokens pure thin aliases of shadcn in BOTH themes, then migrate call sites. Step 1 (bridge both directions, low risk): in the light @theme block (app.css:52-66) replace the hardcoded hex with var() references to the preset — --color-base:var(--background); --color-surface:var(--card); --color-surface-secondary:var(--muted); --color-surface-tertiary:oklch(0.93 0 0) [light step above muted, mirror of the dark :144]; --color-elevated:var(--muted); --color-border-subtle:var(--border); --color-border-active:oklch(0.72 0 0); --color-text-primary:var(--foreground); --color-text-secondary:oklch(0.36 0 0) [no exact preset equiv; --secondary-foreground is 0.21]; --color-text-muted:var(--muted-foreground). NOTE: @theme cannot reference preset vars that are defined in a later plain :root block at theme-compile time — verify; if Tailwind v4 chokes, move these alias assignments out of @theme into the plain :root block (app.css:492-525) like the dark bridge already does, keeping @theme only for the names that must generate utilities. Step 2 (call-site migration, mechanical): rename the 10 custom utilities to their shadcn equivalents across the 33 files — bg-base→bg-background, bg-surface→bg-card, bg-surface-secondary→bg-muted, bg-elevated→bg-muted, text-text-primary→text-foreground, text-text-secondary→text-foreground/70 (or keep a --color-text-secondary), text-text-muted→text-muted-foreground, border-border-subtle→border-border, border-border-active→border-border (or keep). Step 3: once call sites are migrated, DELETE the now-unused --color-base/surface*/elevated/text-*/border-\* token definitions from @theme (app.css:52-66) and the README rows. Defer hard deletion if time-boxed — Steps 1+2 already collapse the vocab functionally.
- REAL 85% DENSITY — trim base sizes, no transform. Targets: (a) body font-size 13px→12px (app.css:217); keep line-height 1.4. This makes text-sm (Tailwind 0.875rem/14px) and the 12px base coexist; since most UI uses named rungs/text-sm, dropping the inherited base to 12px tightens unstyled prose ~8%. (b) status-bar height 24px→20px (app.css:299) and --footer-height 1.5rem→1.25rem (app.css:84) — keep them equal; status-bar font-size 11px→text-2xs equivalent stays. (c) .dv-header-action 28px→24px (app.css:421-422) — MOOT if dockview workstream lands first (those rules get deleted); coordinate. (d) select padding 2px 20px 2px 6px→2px 18px 2px 5px, font-size 12px→11px (app.css:246-247). (e) introduce one new HUD rung if needed: --text-3xs already 10px covers the floor; do NOT add smaller. Net effect ≈85% of current vertical rhythm without a scale() transform. Document the new base in the README density table (replacing the dead --control-height rows).
- RENAME accent-cyan→primary at all 5 call sites. app.css:287 accent-color:var(--color-accent-cyan)→var(--color-primary) (--color-primary is exposed via @theme inline:461). RangeSlider.tsx:23 & :36 'accent-accent-cyan'→'accent-primary'. ViewModeToggle.tsx:15 & :23 'bg-accent-cyan/20 text-accent-cyan'→'bg-primary/20 text-primary' (both ternary branches). Then DELETE the --color-accent-cyan definition (app.css:69-71). Update README.md:87 FilterBadge text 'accent-cyan'→'primary' (also verify FilterBadge.tsx actually uses primary, not accent-cyan — grep showed no accent-cyan in FilterBadge source, so doc is just stale). Leave --color-accent-amber/--color-accent-rose (app.css:72-73) — out of scope, still data-viz accents.
- PURGE dead tokens: delete --control-height-{sm,md,lg} (app.css:106-108) and --row-padding-y-{sm,md,lg} (app.css:109-111) plus the explanatory comment block app.css:102-105; delete the README.md density rows (ui/README.md:64-65) and update the surrounding 'Phase-3 primitives select a density rung' prose to reflect that rungs are text-2xs/text-3xs, not control-height vars.
- TEXT-TAIL MIGRATION to named rungs across 23 files: text-[11px]→text-2xs, text-[10px]→text-3xs, text-[9px]→text-3xs (no 9px rung exists; 9px floor folds into text-3xs/10px — acceptable per HUD legibility; do NOT add a text-4xs). Handle modifiers: field.tsx:41 & :71 text-[10px]/relaxed→text-3xs/relaxed (slash-modifier syntax preserved). field.tsx:84 text-[10px]→text-3xs. EXCLUDE sheet.tsx:130 text-[13px] — that is a title; map to text-sm (14px) or leave as the density-base 12px decision dictates, NOT a micro rung. Per-file edits: ui/tabs.tsx:22, sheet.tsx:140; field.tsx:41/71/84; oklch-color-picker.tsx:32/74/81; dimension-badge.tsx:18 (the CVA base string, ripples to all DimensionBadge consumers); hover-tip.tsx:29; collections CollectionsSheetBody:23, ActiveCollectionCallout:43, CollectionRow:102, SaveCollectionForm:247/252, CollectionsList:115, ExportCollectionDialog:193/196/242/248/270/275/276/279; viewer ChannelControls:74/108/115/151/162/167, VolumeControls:114/123, ViewerErrorBoundary:23, ViewModeToggle:11; table TrackPane:78/88/108/122, TrackGalleryCard:51/62/65/66; charts ChartPanelList:30; toolbar ExportDialog:123/134/165. SKIP layout/DockviewShell.tsx:32 — that file is deleted by the dockview-removal workstream; do not touch.
- FIX stale header comment app.css:16 'DM Sans (UI) + JetBrains Mono (data)' → 'DM Sans (UI prose) + Geist Mono (data/IDs/table) + Geist Pixel (HUD signage)'. Coordinate with the fonts workstream which owns the actual --font-mono repoint to Geist Mono and Geist Pixel @font-face wiring; this workstream only fixes the comment + removes the duplicate --font-mono line (app.css:436 duplicates :50) and the --font-heading decision noted below.
- DEDUPE/FONT-ROLE token hygiene (coordinate with fonts workstream — flagged here because it lives in the same @theme blocks): remove the duplicate --font-mono at app.css:436 (keep one definition). Resolve --font-heading (app.css:435 = var(--font-mono)): dialog/sheet/popover/alert-dialog titles currently render mono — per brand, UI titles should be DM Sans prose, so set --font-heading:var(--font-sans) OR remove font-heading from the title primitives. This is a visible cross-cutting change; surface as an open decision rather than silently flipping.

### Dependencies

- add: —
- remove: @fontsource-variable/martian-mono (package.json:24) — REMOVED here only after the fonts workstream repoints --font-mono off Martian Mono and removes the app.css:5 @import; this workstream should not delete the dep until that import is gone, else build breaks. List it as a shared dead-dep target., dockview-react (package.json:44) — owned by the dockview-removal workstream, NOT this one; noted for build-order coordination only.

### Risks

- @theme cannot forward-reference preset vars defined in a later plain :root block — if the light-mode alias rewrite (Step 1 of dual-vocab collapse) is placed inside @theme it may resolve to empty/invalid at compile. Mitigation: mirror the existing dark bridge pattern (html.dark:141-156 already does var() aliasing in a plain block, not @theme) — move light aliases to the plain :root too. Must run vp check + visually diff light mode.
- Dropping body font-size 13px→12px globally shifts every unstyled text node ~8% smaller; some panels may rely on inherited 13px. Mitigation: this is the intended 85% density, but verify dense panels (TerminalTable, ChannelControls) don't clip; the named-rung migration runs in the same pass so most text is explicitly sized anyway.
- text-[9px]→text-3xs (10px) enlarges the smallest labels by 1px — could break tight layouts (TrackGalleryCard badge :51, kbd hints). Low risk; verify the gallery card and kbd chips.
- Flipping --font-heading from mono→sans changes the look of EVERY dialog/sheet/popover title at once (5 call sites). High visibility — gate behind the open-question decision; do not bundle silently.
- Renaming custom utilities to shadcn across 33 files is mechanical but text-text-secondary has no exact shadcn equivalent (--foreground/70 is an approximation; --secondary-foreground is too dark). Either keep a single --color-text-secondary alias or accept the /70 approximation — pick one to avoid color drift.
- Overlap with dockview-removal (DockviewShell.tsx:32, app.css:312-430 .dv-\*/.dockview rules, .dv-header-action sizing) and fonts workstream (--font-mono/--font-heading/martian-mono import+dep). Touching shared lines risks merge conflicts and double-deletes.

### Verification

- vp check passes (typecheck + Oxlint + Oxfmt) after every edit batch — the token renames are class-string-only so type errors would indicate a typo'd utility.
- grep -rn 'accent-cyan' src/frontend returns ZERO hits (token def, 5 call sites, README all clean).
- grep -rn 'control-height\|row-padding' src/frontend returns ZERO hits.
- grep -rn 'text-\[9px\]\|text-\[10px\]\|text-\[11px\]' src/frontend (excluding sketches/) returns ZERO hits except the deliberately-kept sheet.tsx:130 title and any sketch files.
- grep -c 'font-mono' app.css confirms a single --font-mono definition (duplicate at :436 gone).
- Header comment app.css:16 no longer mentions JetBrains.
- Visual smoke (light + dark): run vp run dev <test yaml>, open :5173, confirm panels (surface/card bg), text muted colors, status bar, RangeSlider/ViewModeToggle periwinkle accent, and dialog/sheet titles all render correctly in both themes. Brackets/BiohubMark unaffected by this workstream.
- Build proof: vp run build succeeds (font @import removal can't break the compiled bundle).
- Light-mode color diff: spot-check that bg-surface (now var(--card)) still reads as a faint off-white panel, not pure white — preset --card is oklch(0.988 0.001 281).

### Open questions

- font-heading decision: flip --font-heading from var(--font-mono) to var(--font-sans) (DM Sans prose titles per brand) OR keep mono titles as an instrument aesthetic? Affects 5 dialog/sheet/popover title call sites at once. (LOCKED spec says 'decide font-heading' — needs an explicit call.)
- text-text-secondary has no exact shadcn equivalent — keep a lone --color-text-secondary alias (minimal collapse) or map all 10 call sites to text-foreground/70 (full collapse, slight color drift)? Recommend keeping the alias to avoid drift; confirm.
- Base font-size: confirm 13px→12px is the desired 85% target, or should density come from line-height (1.4→1.3) instead/additionally? The spec says 'trim base font-size 13px' so 12px is the read, but the exact target value should be confirmed.
- Hard-delete the custom --color-\* token definitions in this PR (after call-site migration), or leave them as aliases for one release to de-risk? Spec says 'finish the collapse' — leaning full delete, confirm appetite.
- 9px floor: acceptable to fold all text-[9px] into text-3xs (10px), or does the brand want a true --text-4xs (9px) HUD rung? Spec lists only text-3xs/2xs as targets, so folding is the read.

---

## bracket-hud-primitives

**Build order:** After font-foundation. Coordinate dockview-removal. Order bracket.tsx, favicon, BottomDock, overlay, sketch.

### Current state

Sketch SketchGallery.tsx has Bk, BracketIcon, Label, readouts. BiohubMark.tsx unused in app. BottomDock.tsx is the status bar.

### Proposed changes

- new ui bracket.tsx with BracketIcon Bk HudReadout
- ScatterOverlayControls drop glass add scatter mark and OBS readout
- BottomDock metrics to HudReadout plus BiohubMark
- index.html favicon to biohub-icon.svg
- app.css font-pixel token plus woff2
- refactor sketch to import primitives

### New files

- ui bracket.tsx
- geist-pixel.woff2
- biohub-icon-accent.svg

### Risks

- Geist Pixel not in npm
- favicon 404 in binary
- right zone shared
- BottomDock may move
- use named rungs
- Brackets clip small

### Verification

- vp run dev verify
- favicon dev binary
- font Geist Pixel
- sketch parity
- vp check test
- a11y

### Open questions

- woff2 source
- READY signal
- BottomDock survival
- favicon color
- picker table marks
- status-bar CSS owner

---

## slidepanel-registry

**Build order:** Depends on: dockview-removal workstream landing the full-bleed scatter + floating layout (DashboardShell.tsx rewrite that drops DockviewShell), since SlidePanel side/offset and the single-active-bottom rule assume floating panels over a full-bleed canvas; and on ui/bracket.tsx which this workstream creates. Depended on by: the status-bar workstream (consumes ui/bracket.tsx Bk + the BracketIcon device, plus BiohubMark wiring) and any future floating panel. Order within this workstream: (1) ui/bracket.tsx, (2) stores/panelRegistry.ts + usePanel, (3) ui/slide-panel.tsx, (4) PanelHotkeys, (5) migrate Collections, (6) migrate Table, (7) migrate Devtools, (8) delete old providers + update App.tsx/DashboardShell/BottomDock/CommandPalette call sites.

### Current state

Three hand-rolled panel mechanisms exist, none sharing a primitive. (1) Sheet at components/ui/sheet.tsx is a Base-UI Dialog (modal=false default, sheet.tsx:27) rendered as a floating inset card; side data-attr drives position (sheet.tsx:75-78), fixed w-360px, rounded-xl, shadow-2xl, header/footer/title/description subcomponents (sheet.tsx:106-144). It has NO resize and NO size persistence. Only one consumer: CollectionsSheet.tsx:11. (2) CollectionsSheet (right) via CollectionsSheetProvider.tsx, useState open + Mod+B hotkey (line 28); openSheet(source, options) carries a live SelectionSource + autoExpandSave through collectionsSheetContext.ts:21-37; mounted at DashboardShell.tsx:82. (3) TerminalTable (bottom) via TerminalTableProvider.tsx: open + height(px), localStorage ndea_table_height (line 12), Mod+J hotkey (line 47), clamp 100..innerHeight-80 (line 36); panel TerminalTable.tsx is a hand-built fixed div (line 55) at bottom var(--footer-height) with its own pointer-drag resize handle (TerminalTable.tsx:33-52,67-74) and internal Tabs Table/Track/Gallery (lines 77-132); provider in App.tsx:40, panel in DashboardShell.tsx:98. (4) DevtoolsDrawer.tsx: local open in DashboardShell useState (line 24), own fixed-height-380 div with hand-rolled tab bar (lines 30-53), tabs query/scatter/render. Hook consumers: BottomDock.tsx:91 (useTerminalTable toggle+open), CommandPalette.tsx:41 (toggleTable), ScatterOverlayControls.tsx:144,299 (openSheet). Brackets/Bk/BracketIcon live only in SketchGallery.tsx:98-121; BiohubMark.tsx exists, used only in the sketch. Tabs primitive ui/tabs.tsx is Base-UI; Kbd in ui/kbd.tsx. No SlidePanel/registry exists (grep: none).

### Proposed changes

- Create ui/slide-panel.tsx as ONE compound primitive built on the existing Base-UI Sheet (sheet.tsx). Compound API mirroring Panel.Header pattern (ui/panel.tsx:70-71): SlidePanel root (props: open, onOpenChange, side=right|bottom default right, id for persistence, defaultSize, minSize, maxSize, modal=false), SlidePanel.Content (renders SheetContent with side, applies persisted size via inline style: width when side=right, height when side=bottom), SlidePanel.Header (bracketed icon + title + close; takes icon: LucideIcon + title; renders BracketIcon + SheetTitle + the SheetPrimitive.Close button already in sheet.tsx:92-100; set showCloseButton=false on SheetContent and own the close in Header so it sits inline next to title per sketch SketchGallery.tsx:233-256), optional SlidePanel.Tabs (thin wrapper over ui/tabs.tsx Tabs/TabsList/TabsTrigger to render the Table/Track/Gallery + Query/Scatter/Render tab rows inline in the header), SlidePanel.Body (min-h-0 flex-1 overflow-auto), SlidePanel.Footer (kbd hint row, reuse SheetFooter styling + ui/kbd.tsx Kbd/KbdMod as in CollectionsSheetBody.tsx:23-34). Edge-resize: add a SlidePanel.ResizeHandle rendered on the inner edge (left edge for side=right, top edge for side=bottom) using the pointer-capture drag pattern lifted verbatim from TerminalTable.tsx:33-52; on drag it calls the registry setSize.
- Promote Bk + BracketIcon from SketchGallery.tsx:98-121 into ui/bracket.tsx as real primitives: Bk (bracketed inline text, span with font-mono + opacity-50 brackets) and BracketIcon (lucide Brackets stretched scale-x-[1.35] around a centered icon, strokeWidth 1.5/2 per sketch). These are consumed by SlidePanel.Header (the [icon] device) and reused by the status-bar workstream. Keep them token-driven (no hardcoded periwinkle).
- Create stores/panelRegistry.ts as a TanStack Store singleton (match existing store style in stores/PointRadiusStore.ts) keyed by panel id. Shape per entry: { open: boolean; size: number (px); side: right|bottom }. Registry API: registerPanel(id, {side, defaultSize, minSize, maxSize}), togglePanel(id), setPanelOpen(id, open), setPanelSize(id, px) with clamp(minSize, maxSize) and localStorage persistence under key ndea*panel*{id} (generalizes the single ndea_table_height key in TerminalTableProvider.tsx:12). One hook usePanel(id) returns {open, size, toggle, setOpen, setSize}. This unifies the open/size/persist logic currently duplicated across the 3 providers.
- Centralize hotkeys in one PanelHotkeys component (or in the registry mount): register Mod+B -> togglePanel('collections') and Mod+J -> togglePanel('table') via useHotkey, replacing the per-provider useHotkey calls in CollectionsSheetProvider.tsx:28 and TerminalTableProvider.tsx:47. Keeps preventDefault:true behavior.
- Migrate Collections (side=right) onto SlidePanel: rewrite CollectionsSheet.tsx to render SlidePanel id=collections side=right with SlidePanel.Header icon=Bookmark title=Collections (replacing the inline svg at CollectionsSheet.tsx:14-30) wrapping the existing CollectionsSheetBody. The selection-passing concern (SelectionSource + autoExpandSave) is orthogonal to layout, so KEEP a thin CollectionsSheetContext for that payload (collectionsSheetContext.ts stays), but drop the open/setOpen/toggle fields from it and source those from usePanel('collections'). openSheet(source, options) now just stashes selection + autoExpand and calls setPanelOpen('collections', true). ScatterOverlayControls.tsx:299 call site is unchanged.
- Migrate Table/Track/Gallery (side=bottom) onto SlidePanel: rewrite TerminalTable.tsx to render SlidePanel id=table side=bottom with SlidePanel.Header icon=Database + SlidePanel.Tabs (Table/Track/Gallery preserving the count/dot badges at TerminalTable.tsx:82-98) and SlidePanel.Footer kbd hint (Mod+J / Esc, mirroring sketch SketchGallery.tsx:316-323). Delete the hand-rolled fixed div, drag handle, and height-clamp logic (TerminalTable.tsx:33-74) in favor of SlidePanel.ResizeHandle + registry size. DataTable/TrackPane/GalleryPane bodies and the galleryEnabled gating (TerminalTable.tsx:93) are preserved inside SlidePanel.Body/Tabs panels.
- Delete TerminalTableProvider.tsx and CollectionsSheetProvider.tsx open/size machinery; register both panels in the registry at startup. Update App.tsx:40 (remove TerminalTableProvider wrapper) and DashboardShell.tsx:82 (remove CollectionsSheetProvider wrapper) — both replaced by mounting the registry/hotkeys + the SlidePanel instances. Update BottomDock.tsx:91 and CommandPalette.tsx:41 to use usePanel('table').toggle instead of useTerminalTable.
- Migrate DevtoolsDrawer (side=bottom) onto SlidePanel too: replace its bespoke 380px div (DevtoolsDrawer.tsx:30-53) with SlidePanel id=devtools side=bottom + SlidePanel.Tabs (Query/Scatter/Render) + SlidePanel.Header. Open state moves from DashboardShell.tsx:24 useState to usePanel('devtools'); BottomDock onToggleDevtools (BottomDock.tsx:111) becomes usePanel('devtools').toggle. NOTE coexistence: table + devtools are both side=bottom; the registry must enforce a single active bottom panel (opening one closes the other) so they do not stack — add an exclusiveGroup notion (e.g. side acts as the group) to togglePanel.
- Wire BiohubMark + Bk into the status bar (BottomDock.tsx) is owned by the status-bar workstream, but this workstream EXPORTS ui/bracket.tsx so that work can consume it. SlidePanel must not hardcode the periwinkle; it inherits --primary on interactive elements only (close hover, active tab underline as in sketch SketchGallery.tsx:241).

### New files

- src/frontend/components/ui/slide-panel.tsx — the compound SlidePanel primitive (root + Content + Header + Tabs + Body + Footer + ResizeHandle) on top of ui/sheet.tsx
- src/frontend/components/ui/bracket.tsx — Bk and BracketIcon promoted from SketchGallery.tsx:98-121
- src/frontend/stores/panelRegistry.ts — TanStack Store singleton: per-id {open,size,side}, register/toggle/setOpen/setSize, localStorage ndea*panel*{id}, usePanel(id) hook, exclusive-by-side bottom grouping
- src/frontend/components/layout/PanelHotkeys.tsx — single mount registering Mod+B and Mod+J against the registry (optional; could fold into a registry init effect)

### Risks

- Base-UI Dialog focus-trap/escape: Sheet uses modal=false (sheet.tsx:27) so it should not trap focus behind full-bleed scatter, but Esc-to-close and outside-press behavior must be verified for a non-modal floating card; the bottom Table panel must NOT steal focus from the scatter canvas (regression risk vs current hand-rolled div which never traps).
- Bottom-side stacking: table and devtools are both side=bottom; without the exclusive-group rule they would overlap. The registry must serialize them. Also both sit above the var(--footer-height) status bar — SlidePanel side=bottom offset must respect --footer-height like TerminalTable.tsx:58 does today, not the sheet.tsx default bottom-4 (sheet.tsx:78).
- Resize ergonomics: SheetContent currently has fixed w-360px / max-h (sheet.tsx:79); applying a persisted inline size must override those utilities (use style attr, and drop the fixed width/height classes for SlidePanel so they don't fight Tailwind specificity).
- Animations: sheet.tsx:83-86 translate-in/out per side — a persisted-size inline style during enter/exit could jump; verify the transition still reads well, or disable size transition during open/close.
- Selection payload coupling: Collections still needs the live SelectionSource at submit time (collectionsSheetContext.ts:11-19); splitting layout (registry) from payload (context) must keep selectionVersion bump (CollectionsSheetProvider.tsx:15,21) so the save section re-reads indices.
- Mod+J/Mod+B centralization: ensure no double-registration once the per-provider useHotkey calls are removed; a leftover registration would toggle twice.

### Verification

- Functional: Mod+B opens the right Collections SlidePanel, Mod+J opens the bottom Table SlidePanel; both toggle closed; opening devtools (bottom) closes the table (exclusive-by-side). Run vp run dev on the infectomics YAML and exercise in-browser; grep the dev bg task for [browser:log] errors.
- Persistence: resize the bottom panel via the edge handle, reload, size restored from localStorage ndea_panel_table (and ndea_panel_devtools, ndea_panel_collections width).
- Selection flow intact: lasso a selection, click the bookmark in ScatterOverlayControls.tsx (openSheet at line 299) -> Collections opens with SaveCollectionSection expanded and the correct count (autoExpandSave + selectionVersion still work).
- Brand: SlidePanel.Header renders [icon] BracketIcon + title; close button hover uses --primary; active tab underline uses --primary (matches sketch SketchGallery.tsx:241,289). No periwinkle on idle chrome.
- Quality gates: vp check (typecheck + Oxlint + Oxfmt) and vp test pass. Confirm no remaining imports of TerminalTableProvider/CollectionsSheetProvider open-state (rg) and useTerminalTable/useCollectionsSheet open fields are gone.
- Non-modal: confirm the scatter canvas remains interactive (pan/zoom) while a SlidePanel is open and Esc closes the focused panel without trapping focus.

### Open questions

- Should the sketch (sketches/SketchGallery.tsx) be deleted now that Bk/BracketIcon are promoted, or kept as a lab behind the ?sketch gate in main.tsx:19? Promotion makes the sketch copies dead; recommend deleting the sketch's local Bk/BracketIcon and either removing the folder or re-importing the real primitives.
- Exclusive-by-side: should opening devtools fully close the table, or should they share the bottom region as tabs of one panel? Sketch shows a single bottom card with tabs (SketchGallery.tsx:232) — consider merging devtools tabs INTO the table SlidePanel rather than a second bottom panel.
- Does Collections need edge-resize (width) or is fixed 360px (sheet.tsx:79) acceptable? Spec says persisted size + edge-resize for the primitive; confirm whether right-side width persistence is in-scope for Collections or only the bottom Table.
- Should PiP (FloatingScatterRoot / ViewerPiP at DashboardShell.tsx:116-124) ever migrate onto SlidePanel, or stay a separate draggable-window primitive? Out of scope here but affects whether SlidePanel needs a free-float side later.

---

## dockview-removal

**Build order:** DEPENDS ON the SlidePanel workstream (ui/slide-panel.tsx + panel-state registry) IF charts are re-homed into a SlidePanel — otherwise this workstream is independent and only consumes the already-existing FloatingWindow + ViewerPiP + TerminalTable + FloatingScatterStore. Should land BEFORE the status-bar/BiohubMark workstream's BottomDock edits (both touch BottomDock.tsx — do the Dockview-decoupling rewrite first, then layer the Geist Pixel HUD + BiohubMark on the cleaned-up status bar to avoid merge conflicts). Independent of the font/token-cleanup workstreams.

### Current state

Dockview is the workspace grid. DashboardShell.tsx:85-92 renders `<DockviewShell>` inside a `relative min-h-0 flex-1` div, captures the `DockviewApi` into `dockviewApiRef`/`dockviewApi` state (DashboardShell.tsx:21-22, 88-91), and threads it into BottomDock (line 105) and PiP-fallback logic (line 33: `dockviewApi?.getPanel("image-viewer")`). DockviewShell.tsx is the only file importing `dockview-react` types/`DockviewReact`/CSS (lines 1-11). It defines: a COMPONENTS registry mapping `scatter|table|image-viewer|charts` → panel wrappers each in PanelErrorBoundary (lines 77-98); `CustomTab` (lines 21-50, custom tab strip — but the strip is hidden via CSS `.dv-tabs-and-actions-container{display:none!important}` at app.css:411-413); `RightHeaderActions` maximize toggle (lines 54-74, styled by `.dv-header-action` app.css:415-430); layout persistence to localStorage key `ndea_layout_v3` via `api.toJSON()` on `onDidLayoutChange` (lines 100, 133-146) and `api.fromJSON()` restore + re-add-missing-panels on ready (lines 154-182); `loadDefaultLayout` adds only `scatter` when hasEmbeddings (lines 104-118 — table lives in TerminalTable, viewer/charts opened on demand). The panel wrapper files only adapt `IDockviewPanelProps` to content: ScatterPanel.tsx (passes `props.api` as `panelApi`, `props.params.initialObsmKey`), TablePanel.tsx (ignores props, renders DataTable), ImageViewerPanel.tsx (reads `props.params.datasetKey`), ChartGroupPanel.tsx (ignores props). ScatterContent.tsx is already container-agnostic (header comment lines 1-8) but its props take an optional `panelApi?: DockviewPanelApi` (line 46, imported line 10) used only to forward to ScatterOverlayControls. ScatterOverlayControls.tsx imports `DockviewPanelApi` (line 49) and uses `panelApi` for three buttons: Float (`addFloatingScatter(...); panelApi.close()` lines 362-384), Fullscreen (`panelApi.maximize()/exitMaximized()` lines 386-401), Close (`panelApi.close()` lines 403-418). BottomDock.tsx imports `DockviewApi` (line 10), takes it as a prop (line 68), and is largely a Dockview-panel navigator: it subscribes to `onDidAddPanel/onDidRemovePanel/onDidActivePanelChange` (lines 123-130), builds a `panels` list (lines 105-118), renders scatter dots (lines 148-172), add-scatter "+" (lines 175-188), table icon (191-211), single/multi viewer icons (213-293), and `activate(id)=api.getPanel(id).focus()` (lines 141-143); it ALSO owns the real status bar (point-size slider, metrics numPoints/selectedCount/zoom/fps, ⌘K/⌘J/devtools/theme controls, lines 295-397). FloatingScatterRoot/FloatingScatterWindow.tsx and ViewerPiP.tsx/DatasetViewerPiP already render OUTSIDE Dockview via the FloatingWindow primitive (useFloatingWindow) — these are the model the migration adopts. orchestrator.ts:282 only has a stale comment mentioning Dockview. Charts (ChartGroupPanel/ChartPanelList) is registered in COMPONENTS but has NO live entry point — never added by loadDefaultLayout, no CommandPalette item adds it, BottomDock has no charts icon — so the `charts` panel is effectively dead today. Dep: dockview-react ^6.4.0 (package.json:44). CSS: app.css:312-335 (dark theme vars), 370-408 (light/abyss vars + .dv-_ overrides), 410-430 (hide tab strip + .dv-header-action) — ~45 lines total across the .dv-_/.dockview blocks.

### Proposed changes

- DELETE the dock grid: in DashboardShell.tsx replace the `<DockviewShell .../>` block (lines 85-92) with a full-bleed `<ScatterWorkspace/>` that renders the primary scatter directly. Concretely, render ScatterContent (panelId=panelId('scatter'), no panelApi) filling the `relative min-h-0 flex-1` container at DashboardShell.tsx:84, with ActiveCollectionCallout kept as its sibling (line 94). Drop `dockviewApiRef`/`dockviewApi` state (lines 21-22) and the `onApiReady` plumbing (lines 88-91).
- REPLACE 'panel mounting' for table+charts with SlidePanel (the new ui/ primitive on ui/sheet.tsx). Table: TablePanel.tsx content (DataTable) already renders inside TerminalTable (⌘J, fixed bottom drawer, TerminalTable.tsx:56) — keep that path; delete TablePanel.tsx (it is a dockview-only wrapper). Charts: since `charts` has no live entry point today, either (a) drop ChartGroupPanel.tsx entirely, or (b) re-home ChartPanelList into a side=right SlidePanel registered in the new panel registry and add a CommandPalette item to open it. Default to (a) delete unless the design spec wants charts back — flag as open question.
- REPLACE 'panel mounting' for image viewer with the EXISTING PiP path. ViewerPiP/DatasetViewerPiP (ViewerPiP.tsx) + FloatingScatterRoot already render at DashboardShell level (lines 116-124) and survive independently — make PiP the only viewer surface. Delete ImageViewerPanel.tsx and the dockview docked-viewer branch.
- REWIRE DashboardShell viewer handlers (lines 56-79): `openViewerPanel`/`closeViewerPanel` currently manipulate the dockview `image-viewer` panel (lines 56-75). Replace `openViewerPanel` with `openViewerPiP()` (already imported, line 13) and DELETE `closeViewerPanel` (PiP self-closes via FloatingWindow). Update the PiP-auto-open effect (lines 27-35): drop the `dockviewApi?.getPanel('image-viewer')` docked-exists guard (line 33) — with no dock, always `openViewerPiP()` on first highlight when plate exists.
- REWIRE addScatterPanel (DashboardShell.tsx:37-50): today it calls `api.addPanel({component:'scatter', position:{referencePanel,direction:'right'}})`. Replace with `addFloatingScatter({...})` (the store FloatingScatterWindow.tsx already uses, imported from stores/FloatingScatterStore) so '+ new scatter' / ⌘K opens a floating scatter window instead of a docked tile. The primary scatter stays full-bleed; additional scatters float.
- REPLACE BottomDock's Dockview navigator with a pure status bar. Remove the `dockviewApi` prop (line 68) and import (line 10), the panel-tracking effect (lines 101-135), the `panels`/`activePanelId` state (lines 95-98), scatter dots (148-172), table icon (191-211), docked-viewer icons (213-252), and `activate()` (141-143). Drive the scatter-list dots (if kept) from FloatingScatterStore + a single 'primary' entry instead of the dockview panels array; viewer/table buttons call `openViewerPiP()`/`toggleTable` directly. Keep the entire status-bar half (slider + metrics + ⌘K/⌘J/devtools/theme, lines 295-397) unchanged. Per the design spec this bar gains the BiohubMark bottom-right and Geist Pixel HUD readouts — coordinate with the status-bar workstream; this workstream only removes the Dockview coupling.
- STRIP panelApi from the scatter stack. ScatterContent.tsx: remove the `panelApi?: DockviewPanelApi` prop (line 46) and its import (line 10); stop forwarding `panelApi` to ScatterOverlayControls (line 260). ScatterOverlayControls.tsx: remove the `DockviewPanelApi` import (line 49) and `panelApi?` prop (line 97); DELETE the Fullscreen button (lines 386-401, maximize has no meaning in full-bleed/float model) and the Close button (lines 403-418, the primary scatter is not closable; floating ones close via FloatingWindow's own X). KEEP the Float button (lines 362-384) but drop the trailing `panelApi.close()` — Float now spawns a floating copy while the primary remains.
- DELETE DockviewShell.tsx entirely (CustomTab, RightHeaderActions, COMPONENTS, loadDefaultLayout, persistence — all dockview-specific). Its PanelErrorBoundary wrappers move to the new ScatterWorkspace / SlidePanel content (wrap ScatterContent + ChartPanelList in PanelErrorBoundary at their new call sites so the existing error isolation is preserved).
- REMOVE the dependency `dockview-react` from package.json:44 and run `vp install` to update the lockfile.
- REMOVE the CSS: delete app.css:312-335 (.dockview-theme-abyss/.dockview-theme-dark vars), app.css:370-408 (light/abyss vars + all `:root:not(.dark) .dv-*` overrides), and app.css:410-430 (`.dv-tabs-and-actions-container{display:none}` + `.dv-header-action`). These are the ~45 .dv-\*/.dockview lines called out in the locked decision.
- FIX the stale comment at orchestrator.ts:282 ('hidden/collapsed Dockview panel') — reword to reference a hidden/0-size float/PiP container; the 0-size canvas guard itself stays valid (floating windows can mount at 0 size before layout).
- REMOVE the now-unused localStorage key `ndea_layout_v3` (DockviewShell.tsx:100). The CommandPalette 'Reset Layout' item (CommandPalette.tsx:167-177) does `localStorage.clear()` so it still works; consider renaming it 'Reset Panels' and clearing only the float/PiP/terminal-table size keys. Flag layout-persistence loss as a risk (below).

### New files

- src/frontend/components/layout/ScatterWorkspace.tsx — thin full-bleed host that renders the primary ScatterContent (wrapped in PanelErrorBoundary) and is the new sibling of ActiveCollectionCallout in DashboardShell; replaces DockviewShell as the workspace root.
- (SHARED with SlidePanel workstream, do not create here) src/frontend/components/ui/slide-panel.tsx + the panel-state registry — this workstream consumes them for table/charts but the SlidePanel workstream owns their creation.

### Dependencies

- add: —
- remove: dockview-react

### Risks

- LOSS OF LAYOUT PERSISTENCE: `toJSON()/fromJSON()` (DockviewShell.tsx:138,157) saved tile arrangement, sizes, and which panels were open across sessions. The full-bleed+float model has no equivalent multi-panel geometry to restore. Floating windows already do NOT persist position/size (useFloatingWindow holds in-memory state). Net: users lose remembered workspace layout. Mitigation: optionally persist FloatingScatterStore entries + PiP open-state + terminal-table size to localStorage; otherwise accept the simplification (the spec's full-bleed direction implies a single canonical layout).
- MULTI-SCATTER side-by-side comparison REGRESSES to floating windows. Today addScatterPanel docks a second scatter beside the first (direction:'right', DashboardShell.tsx:48) giving tiled comparison; floats overlap and must be manually arranged. Confirm the design accepts floating-only multi-scatter (the spec's ViewSyncStore link button already targets floats, FloatingScatterWindow.tsx:50-59, so this is intended).
- MAXIMIZE removal: RightHeaderActions + the Fullscreen overlay button gave a one-panel-fills-workspace mode. In full-bleed the primary scatter is already maximal, so this is largely redundant — but floating scatters lose a maximize affordance. Low impact.
- ACTIVE-PANEL TRACKING removal: BottomDock dots reflected dockview `activePanel` (lines 121,129). Cross-panel features that key off 'active' (selection sync, view-lock target in FloatingScatterWindow.tsx:53-58 picks 'first non-float panel') must still resolve a primary panel id. After removal the primary scatter's PanelId must remain a stable, well-known id (e.g. panelId('scatter')) so PanelStateStore link resolution keeps working.
- PanelErrorBoundary coverage gap: each dockview COMPONENTS entry wrapped content in PanelErrorBoundary (DockviewShell.tsx:78-97). Must re-wrap ScatterContent and any SlidePanel content at the new call sites or a render error takes down the whole shell instead of one panel.
- ScatterContent 0-size mount: docked panels were always sized; floating/PiP can mount at 0×0 before layout (orchestrator.ts:282 guard). The full-bleed primary is fine, but verify floating scatters still init their GPU canvas correctly post-migration.

### Verification

- grep -rn 'dockview' src/ returns ZERO hits (after fixing orchestrator.ts:282 comment) — no imports, no types, no CSS classes, no package.json entry.
- vp check passes (typecheck must confirm DockviewApi/DockviewPanelApi/IDockviewPanelProps imports are fully gone and ScatterContent/ScatterOverlayControls/BottomDock compile without the removed props).
- vp run build produces dist/ndea with no dockview-react in the bundle; bundle size drops by the dockview-react footprint.
- FUNCTIONAL (run `vp run dev /Users/sricharan.varra/Biohub/ome-atlas-test-data/infectomics/infectomics.yaml`, open :5173): primary scatter renders full-bleed with overlay controls; ⌘K → New Scatter opens a FLOATING scatter (not a docked tile); ⌘J toggles the terminal table; ⌘K → Open/Float Image Viewer opens the PiP; status bar shows points/selected/zoom/fps; theme + devtools toggles work.
- DESIGN (graphic-realism instrument): full-bleed scatter + floating SlidePanels match the SketchGallery target; status bar bottom-right shows BiohubMark and Geist Pixel HUD readouts (verify against the status-bar workstream); no Dockview tab-strip chrome or abyss-blue tint anywhere.
- No console errors on first highlight when plate data is present (PiP auto-opens once via the rewired effect; the removed getPanel('image-viewer') guard does not throw).

### Open questions

- Charts: drop ChartGroupPanel/ChartPanelList entirely (it has no live entry point today), or re-home ChartPanelList into a side=right SlidePanel with a new ⌘K item? Need product call.
- Multi-scatter: is floating-window-only comparison acceptable, or is a side-by-side split (currently provided by dockview direction:'right') a required capability that needs a different layout primitive?
- Layout persistence: should FloatingScatterStore + PiP open-state + terminal-table size be persisted to localStorage to partially replace the lost ndea_layout_v3 toJSON/fromJSON, or is per-session-only acceptable?
- Should the primary full-bleed scatter expose a Float/Close affordance at all, or is it permanently the canonical canvas (overlay Float button keeps spawning floating copies, no Close)?
- Reset Layout command (CommandPalette.tsx:167) does localStorage.clear() — keep the broad clear, or scope it to only float/PiP/table keys now that ndea_layout_v3 is gone?

---

## Consolidated

**Deps to add:** geist@^1.7.2 — OPTIONAL, only as upstream source for the vendored Geist Pixel woff2. Recommended NOT to add (exports are next/font-only, not importable in Vite+Bun); vendor the file and skip the dep.

**Deps to remove:** @fontsource-variable/martian-mono — remove from package.json dependencies (line 24); not @imported after the Geist Mono revert and not referenced once the sketch override is removed., @fontsource-variable/martian-mono (package.json:24) — REMOVED here only after the fonts workstream repoints --font-mono off Martian Mono and removes the app.css:5 @import; this workstream should not delete the dep until that import is gone, else build breaks. List it as a shared dead-dep target., dockview-react (package.json:44) — owned by the dockview-removal workstream, NOT this one; noted for build-order coordination only., dockview-react

**All open questions:**

- (Fonts) font-heading final call: keep dialog/sheet TITLES in Geist Mono (matches sketch signage, recommended) or switch to DM Sans? Affects app.css:435 only.
- (Fonts) Which Geist Pixel face for HUD: Square (most legible, package default, recommended) vs Grid (literal pixel-grid, noisier at 10px)? Determines which woff2 is vendored.
- (Fonts) Vendor the woff2 (recommended, no importable dep) vs add the geist npm dep plus a postinstall copy? Confirm stance on committing a binary font vs a build-step copy.
- (Fonts) Delete the orphan .status-bar CSS rule (app.css:298-310, no TSX consumer) now or leave to the cleanup workstream?
- (Fonts) Confirm the html-default flip from font-mono to font-sans (app.css:537) is wanted now: required for the role split to read correctly but the highest-blast-radius single edit; may belong in a coordinated role-flip commit with a full screenshot pass.
- (tokens-density-cleanup) font-heading decision: flip --font-heading from var(--font-mono) to var(--font-sans) (DM Sans prose titles per brand) OR keep mono titles as an instrument aesthetic? Affects 5 dialog/sheet/popover title call sites at once. (LOCKED spec says 'decide font-heading' — needs an explicit call.)
- (tokens-density-cleanup) text-text-secondary has no exact shadcn equivalent — keep a lone --color-text-secondary alias (minimal collapse) or map all 10 call sites to text-foreground/70 (full collapse, slight color drift)? Recommend keeping the alias to avoid drift; confirm.
- (tokens-density-cleanup) Base font-size: confirm 13px→12px is the desired 85% target, or should density come from line-height (1.4→1.3) instead/additionally? The spec says 'trim base font-size 13px' so 12px is the read, but the exact target value should be confirmed.
- (tokens-density-cleanup) Hard-delete the custom --color-\* token definitions in this PR (after call-site migration), or leave them as aliases for one release to de-risk? Spec says 'finish the collapse' — leaning full delete, confirm appetite.
- (tokens-density-cleanup) 9px floor: acceptable to fold all text-[9px] into text-3xs (10px), or does the brand want a true --text-4xs (9px) HUD rung? Spec lists only text-3xs/2xs as targets, so folding is the read.
- (bracket-hud-primitives) woff2 source
- (bracket-hud-primitives) READY signal
- (bracket-hud-primitives) BottomDock survival
- (bracket-hud-primitives) favicon color
- (bracket-hud-primitives) picker table marks
- (bracket-hud-primitives) status-bar CSS owner
- (slidepanel-registry) Should the sketch (sketches/SketchGallery.tsx) be deleted now that Bk/BracketIcon are promoted, or kept as a lab behind the ?sketch gate in main.tsx:19? Promotion makes the sketch copies dead; recommend deleting the sketch's local Bk/BracketIcon and either removing the folder or re-importing the real primitives.
- (slidepanel-registry) Exclusive-by-side: should opening devtools fully close the table, or should they share the bottom region as tabs of one panel? Sketch shows a single bottom card with tabs (SketchGallery.tsx:232) — consider merging devtools tabs INTO the table SlidePanel rather than a second bottom panel.
- (slidepanel-registry) Does Collections need edge-resize (width) or is fixed 360px (sheet.tsx:79) acceptable? Spec says persisted size + edge-resize for the primitive; confirm whether right-side width persistence is in-scope for Collections or only the bottom Table.
- (slidepanel-registry) Should PiP (FloatingScatterRoot / ViewerPiP at DashboardShell.tsx:116-124) ever migrate onto SlidePanel, or stay a separate draggable-window primitive? Out of scope here but affects whether SlidePanel needs a free-float side later.
- (dockview-removal) Charts: drop ChartGroupPanel/ChartPanelList entirely (it has no live entry point today), or re-home ChartPanelList into a side=right SlidePanel with a new ⌘K item? Need product call.
- (dockview-removal) Multi-scatter: is floating-window-only comparison acceptable, or is a side-by-side split (currently provided by dockview direction:'right') a required capability that needs a different layout primitive?
- (dockview-removal) Layout persistence: should FloatingScatterStore + PiP open-state + terminal-table size be persisted to localStorage to partially replace the lost ndea_layout_v3 toJSON/fromJSON, or is per-session-only acceptable?
- (dockview-removal) Should the primary full-bleed scatter expose a Float/Close affordance at all, or is it permanently the canonical canvas (overlay Float button keeps spawning floating copies, no Close)?
- (dockview-removal) Reset Layout command (CommandPalette.tsx:167) does localStorage.clear() — keep the broad clear, or scope it to only float/PiP/table keys now that ndea_layout_v3 is gone?

> NOTE: the `bracket-hud-primitives` section came back thin in the workflow — flesh it out from the sketch (BracketIcon/Bk/BiohubMark/status-bar HUD) during execution or a follow-up planning pass.

---

## ✅ Annotation resolutions (authoritative — supersede the open questions above)

These come from the Plannotator review and override any conflicting open question.

- **Charts:** DROP `ChartGroupPanel` + `ChartPanelList` entirely for now (no live entry point today). Re-add later, likely as a `side=right` SlidePanel.
- **Multi-scatter:** floating-window-only comparison. Drop Dockview's `direction:'right'` split; no split-layout primitive. Simplest path wins.
- **Layout persistence:** PER-SESSION ONLY. Do NOT persist FloatingScatter / PiP open-state / table size to localStorage. The lost `ndea_layout_v3` is not replaced.
- **Reset Layout command** (`CommandPalette.tsx:167`, `localStorage.clear()`): REMOVE it — pointless with no saved layout state.
- **Devtools vs table:** exclusive bottom region — opening devtools FULLY CLOSES the table (and vice-versa) for now. (A dedicated Settings panel is planned soon; devtools likely moves there.)
- **Collections panel:** FIXED 360px width, no edge-resize for now (the `sheet.tsx` default is fine). The bottom Table panel may still resize in-session, but its size is NOT persisted (per-session only).
- **PiP / FloatingScatter:** stays a separate draggable-window primitive (FloatingWindow). NOT migrated onto SlidePanel; SlidePanel needs no free-float side.
- **Sketch (`src/frontend/sketches/`, `?sketch` gate):** KEEP for now as an implementation reference. Still promote the real `Bk`/`BracketIcon`/`BiohubMark` primitives; the sketch may keep its local copies or re-import the real ones — do not delete the folder until execution is done.
- **Primary scatter affordance:** the full-bleed scatter is the PERMANENT canonical canvas → NO Close, NO Fullscreen button. KEEP the "Float" button, which spawns a DUPLICATE floating scatter for side-by-side; the primary stays put.

### Type scale & "retina"/pixel sizing (resolves the 9px-floor question)

- Vector faces (DM Sans, Geist Mono) are crisp at any size on 2× displays — no special "retina size." The floor is legibility: interactive text ≥10px, base ~12px.
- Adopt a **modular rem scale** (~1.2 ratio): `10 · 11 · 12 · 13 · 15 · 18 · 21 · 25px` as named rungs (`--text-3xs`…). Fold stray `text-[9px]` → `text-3xs` (10px).
- **Geist Pixel** is the real pixel constraint: bitmap faces stay crisp ONLY at integer multiples of their native pixel grid. Lock HUD pixel readouts to the font's native size (and 2×); test to find it (commonly 10/12px). Add a `--text-4xs` (~8–9px) rung ONLY if the Pixel grid requires it. HUD = grid-aligned fixed px; everything else = the rem scale.
