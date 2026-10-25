# ndea Design System

ndea is a desktop tool for exploring large collections of observations (cells, tissue patches, organoids, tracked objects). Each observation has tabular metadata, several ML embeddings, and links back to multidimensional imaging data (t, c, z, y, x). The core loop: see structure in an embedding, select or filter, look at the images behind the points, compare, label.

This system is the shell and component language distilled from the ndea dashboard prototype in this project. Its visual identity melds the **Biohub Design System** (teal/periwinkle accents, Helvetica option, keylines, data-viz sets) with the **Pierre Dark** VS Code palette (neutrals and syntax accents for dark mode).

## Sources
- `ndea Shell.dc.html` + `ndea-core.js` (this project): the working prototype every value here was taken from.
- Biohub Design System (bound at `_ds/biohub-design-system-47365be2-0599-401e-ac24-480be920fe75/`): brand colors, keyline rules, light-mode data set.
- Pierre Dark palette (pasted by the user): surfaces, text, selection, status and syntax colors for dark mode.
- Earlier explorations: `archive/` (their relative script paths no longer resolve after the move).

## Index
- `styles.css`: global entry, `@import` list only.
- `tokens/`: `fonts` · `colors` (base palettes) · `theme` (semantic, light on `:root`, dark on `.dark`) · `typography` (+ font-set classes) · `layout` · `elevation` · `motion` · `base`.
- `guidelines/`: foundation specimen cards (Colors, Type, Spacing).
- `components/`: `core` (Icon, Button, IconButton, OverlayButton, OverlayGroup) · `forms` (Input, Select, Checkbox, RangeSlider) · `navigation` (SegmentedControl, Tabs, SidebarRail) · `layout` (Tile, TileSlot) · `overlay` (Popover, Menu, Toast, Toaster, Tooltip) · `command` (CommandMenu) · `data` (Pill, Badge, Kbd, Legend, ScopeIndicator, ScopeRow, DataTable).
- `components/dev-loader.js`: loads component sources in-browser when the compiled bundle is not present.
- `ui_kits/dashboard/`: the exploration layout composed from the components.
- `SKILL.md`: Agent Skills entry point.

## Using it
```html
<html class="dark">            <!-- default; remove for light -->
<link rel="stylesheet" href="styles.css">
```
- Theme: shadcn convention. Light tokens on `:root`, dark on `.dark`.
- Font set: add one class to `<html>`: `font-helvetica`, `font-swiss`, `font-plex`, `font-condensed`, `font-grotesk`, `font-soft`, `font-terminal`, `font-hud`. Default (no class) is Geist + Geist Mono.
- Motion: `motion-off` on `<html>` zeroes every duration.
- Token names match shadcn (`--background`, `--foreground`, `--card`, `--primary`, `--muted`, `--muted-foreground`, `--accent`, `--border`, `--ring`, `--radius`, `--chart-1..5`) plus `--surface` (tile bodies) and `--text-muted`, so they port straight into Tailwind.

## Content fundamentals
- Matter-of-fact, instrument voice. Labels state what a thing is and how many: "48,312 cells", "4 of 4 plates", "12 of 40", "Saved 12 edits".
- Sentence case for titles and buttons ("Choose a component", "Save as source"). Lowercase for field names and values, which appear verbatim in mono (`cell_area`, `treatment = Taxol`).
- Exact counts, always with thousands separators and tabular figures. No approximations in UI chrome.
- No marketing copy, no exclamation marks, no emoji. Tooltips are short: "Linked: F1, FOCUS, COLOR", "From obs in the file · read-only".
- " · " separates facets in one line ("UMAP · dinov2-s14 · n_neighbors 15"). Toast title is what happened; description is the count or target.
- The agent is referred to by its harness name (claude-code). The app never chats; edits arrive as proposals to accept or reject.

## Visual foundations
- **Color.** Dark (default): Pierre neutrals, page #0a0a0a, tiles #101010, popovers #171717, inputs #1d1d1d, lines #262626/#2c2c2c, tile ring #404040; text #fafafa / #a3a3a3 / #636363. Accent is Biohub teal #26CFDB; selected rows use Pierre's selection blue #19283c with #9fd8ff text; focus mark is Pierre gold #ffd452. Light: Biohub white, light slate #DEE8EB fills, slate keylines, periwinkle accent, iris on lavender selection. Color is reserved for data; chrome stays neutral.
- **Data color.** Categorical d1–d9 (dark: teal, orange, violet, pink, grey, white, sky, gold, magenta; light: the Biohub-approved periwinkle/indigo/lavender/black/graphite set). Continuous fields use viridis. Scopes reuse d1–d3 (filter, focus, color-by).
- **Type.** Geist for UI at 11–13px with medium (500) for titles; Geist Mono for anything that is data. Tabular numerals everywhere. Font sets swap both faces with one class.
- **Layout.** Full-height shell: a 32px icon rail on the left, tiles in a CSS grid with 4px gutters and 4px edges. Vertical space is prioritized; nothing is docked along the top or bottom. Flyouts and popovers overlay; they never push tiles.
- **Tiles.** Surface fill, 7px corners, a 1.15px tile ring (no shadow), 30px header with title or tabs, muted subtitle, and right-aligned icon actions. Canvases are full-bleed inside the tile.
- **Corners.** Softened Biohub: 3.5 / 4.2 / 4.9 / 7 / 8.4 / 9.8px and pills. Never fully square, never bubbly.
- **Lines.** 0.5px keylines inside popovers and tables; 1.15px rings around tiles and the rail. No colored left-border accents except the 2px dirty-cell bar.
- **Elevation.** Light mode is flat: keylines replace shadows. Dark mode uses soft, diffuse shadows only on floating layers (popover, toast, command menu); tiles never cast shadows.
- **Backgrounds.** Flat. No gradients except the viridis legend bar, no textures, no imagery except the scientific images themselves.
- **Transparency.** Only for scrims behind the command menu and protection on image overlays. No glass or blur.
- **States.** Hover lightens the fill one step (transparent → muted) and raises text to foreground. Active/applied uses the accent fill. Selected segmented options sit on a raised card-colored thumb. Disabled is 45% opacity.
- **Motion.** 140 / 180 / 260ms, ease-out cubic, no bounce, nothing over 300ms. Popovers rise 4px with a 0.985 scale; toasts slide up 16px; segmented thumbs and tabs slide; layout changes FLIP tiles; filtered points cross-fade; counts roll; a rejected agent edit shakes once.
- **Provenance.** Table columns carry a marker: none = from the file (obs, read-only), filled dot = saved annotation, hollow amber ring = unsaved. Edited cells get a 2px amber bar.

## Iconography
- Lucide line icons from CDN (`lucide-static`), drawn at 13–15px with a 1.5 stroke, round caps and joins, via the `Icon` component.
- ndea custom icons extend Lucide on the same 24px grid: `nd-legend`, `nd-legend-continuous`, `nd-scopes`, `nd-embedding`, `nd-crops`, `nd-slot`, `nd-split`, `nd-axis-swap`, `nd-color-by`, `nd-channels`, `nd-harness`.
- Icons only where words would crowd a tile header or the rail; everything else is text. No emoji, no unicode glyphs as icons (the table type glyphs Aa # ◉ ◇ ☑ are typographic markers, not icons).
- No logo ships. The rail shows the wordmark "nd" in plain type.

## Intentional additions
- `Icon`: wrapper for Lucide plus the custom set.
- `TileSlot`, `ScopeRow`, `Toaster`: companion exports needed to compose Tile, ScopeIndicator and Toast.
- `dev-loader.js`: preview helper, not a component.
