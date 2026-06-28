# DESIGN.md — nd-embedding-atlas · Node Workspace

> Impeccable/Stitch-format visual system summary. The authoritative sources
> are `src/frontend/app.css` (repo tokens) and `prototype/tokens.css`
> (prototype bridge) — refresh this file via `/impeccable document` once the
> real implementation exists.

## Colors

- `--base` oklch(0.13 0.004 281) — canvas substrate (dark primary)
- `--surface` oklch(0.205 0 0) · `--surface-2/3` step lighter — node/tile bodies
- `--primary` oklch(0.554 0.236 281) `#6E4FF9` periwinkle — selection, claiming, active states
- Wire/port kinds: predicate `#8b7bf7` (rest 65% alpha) · selection `#f59e0b` amber · focus `#38bdf8` sky
- States: clean `oklch(0.69 0.19 170)` · dirty/stale amber · error `oklch(0.704 0.191 22.216)` · inactive 45% gray
- Glass chrome: `--glass-bg` + 12px backdrop blur, `--glass-border`
- Borders: `--border-subtle`, `--border-active`; text: `--text-primary/secondary/muted`

## Typography

- **Geist Mono** — the ONE text face: UI labels, node titles (10.5–12px
  in-canvas) and all data: counts, predicates, epochs, hints (8.5–10px)
- **Geist Pixel** (vendored woff2) — HUD signage only, uppercase, 8–10px
- Bracketed counts `[412,809]`; lowercase telemetry; no marketing type on work surfaces

## Components (see component-spec/ and prototype/nd-node.jsx)

- **NdNodeFrame** — chip (pill 26px) / card / full-body forms; 26px header:
  LED · title · meta · spacer · actions · count
- **NdPort** — 11px typed glyph: circle/diamond/square by kind; filled=out, hollow=in
- **NdIconButton + ND_ICONS** — 15px (14 compact) grid-centered icon buttons,
  10×10 SVG registry; tones default/active/amber; actions declared as data
- **NdBreadcrumb** — shadcn anatomy, mono 9.5px, chevron separators, current page primary
- **NdLed / NdChip / NdHud / NdBracketed** — telemetry atoms
- Stage tiles, sashes (8px hit/2.5px line), empty slots (dashed), glass popovers (208px)
- Wires: bezier, horizontal tangents, ctrl offset max(|dx|·0.45, 24);
  cooking dash 7-7 @0.6s; push dash 2-10 round @0.45s; focus dash 1-6

## Spacing & geometry

- Radii: 7px nodes/tiles · 999 chips · 3px buttons · 4-6px chips/popovers
- 8px workspace gutter grid; 22px canvas dot-grid; z-order: wires(2) < nodes(3) < selected(5) < claimed(6) < ports(8) < chrome(10) < cursor(60)

## Motion

- Pane/camera transitions 420ms cubic-bezier(.3,.8,.3,1); form morph 220ms; FLIP relocation ghosts
- Cursor morph: color 70ms, shape 160ms with 60ms delay (color leads)
- Slide-in states animate FROM hidden; all motion gated on prefers-reduced-motion
