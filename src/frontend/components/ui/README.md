# UI primitives

Local design system: shadcn/ui primitives we own + domain primitives tuned for scientific instrument UI. All components here are source code we edit directly; the `ignorePatterns` entry in `vite.config.ts` exempts this tree from project-wide lint rules so shadcn defaults compile as-shipped.

## Token tiers (`src/frontend/app.css`)

Two tiers live in the CSS file; a third is available but used sparingly.

### Tier 1 — primitives

Raw source values. Never used directly by components.

| Token           | Light                                | Dark | Purpose                                                        |
| --------------- | ------------------------------------ | ---- | -------------------------------------------------------------- |
| `--base-hue`    | `277.117`                            | same | Master hue knob — shifts the UI tone (cool/warm) in one place. |
| `--accent-hue`  | `oklch(0.585 0.233 var(--base-hue))` | same | Source for `--emphasis` tints.                                 |
| `--danger-hue`  | `oklch(0.577 0.245 27.325)`          | same | Source for `--danger-emphasis`.                                |
| `--warning-hue` | `oklch(0.741 0.181 60)`              | same | Source for `--warning-emphasis`.                               |
| `--success-hue` | `oklch(0.69 0.19 170)`               | same | Source for `--success-emphasis`.                               |

### Tier 2 — semantics

Two vocabularies coexist. **shadcn vocab is canonical** (every shadcn primitive depends on it). Custom vocab (`--color-base`, `--color-surface`, etc.) stays for historical call sites; new code should prefer shadcn names.

**shadcn-canonical** (utilities like `bg-background`, `text-foreground`, `border-border`, `ring-ring`): see `:root` and `html.dark` blocks near the bottom of `app.css`.

**Our custom vocab** (utilities like `bg-base`, `text-text-primary`):

| Utility                                                         | Light                             | Dark                                                                |
| --------------------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------- |
| `bg-base` / `bg-surface` / `bg-elevated`                        | `#ffffff` / `#f7f7f7` / `#ebebeb` | `var(--background)` / `var(--card)` / `var(--muted)`                |
| `bg-surface-secondary` / `bg-surface-tertiary`                  | `#f0f0f0` / `#e8e8e8`             | `var(--muted)` / `oklch(0.32 0 0)`                                  |
| `border-border-subtle` / `border-border-active`                 | `#e8e8e8` / `#b8b8b8`             | `var(--border)` / `oklch(1 0 0 / 22%)`                              |
| `text-text-primary` / `text-text-secondary` / `text-text-muted` | `#111` / `#444` / `#6e6e6e`       | `var(--foreground)` / `var(--muted-foreground)` / `oklch(0.62 0 0)` |

**Emphasis family** (tinted backgrounds for pills, callouts, selected rows):

| Utility               | Derived from    | Light alpha | Dark alpha |
| --------------------- | --------------- | ----------- | ---------- |
| `bg-emphasis`         | `--accent-hue`  | 5%          | 10%        |
| `bg-danger-emphasis`  | `--danger-hue`  | 10%         | 15%        |
| `bg-warning-emphasis` | `--warning-hue` | 7%          | 12%        |
| `bg-success-emphasis` | `--success-hue` | 10%         | 15%        |

**Glass surface** (frosted overlays):

| Utility                             | Light                | Dark                 |
| ----------------------------------- | -------------------- | -------------------- |
| `bg-glass-bg`                       | `oklch(1 0 0 / 80%)` | `oklch(0 0 0 / 60%)` |
| `border-glass-border`               | `oklch(0 0 0 / 7%)`  | `oklch(1 0 0 / 7%)`  |
| `backdrop-blur-[var(--blur-glass)]` | `12px`               | same                 |

**Typography** (named rungs below Tailwind's default `text-xs`):

| Utility    | Value              | Intent                       |
| ---------- | ------------------ | ---------------------------- |
| `text-2xs` | `0.6875rem` / 11px | Tight labels.                |
| `text-3xs` | `0.625rem` / 10px  | Dense legend / tooltip text. |

**Density**: compact controls use the named text rungs (`text-2xs` / `text-3xs`) plus Tailwind
height/padding utilities (`h-*`, `py-*`). There are no bespoke `--control-height-*` tokens.

## Primitive matrix

### shadcn defaults

`button`, `badge`, `input`, `input-group`, `textarea`, `select`, `combobox`, `command`, `context-menu`, `dialog`, `hover-card`, `popover`, `sheet`, `tabs`, `tooltip`, `toggle`, `toggle-group`, `slider`, `separator`, `scroll-area`, `resizable`, `skeleton`, `collapsible`, `sonner`, `hover-tip`, `kbd`, `oklch-color-picker`.

Edit in place when you need variants — `Button`'s CVA block is the template.

### Domain primitives (nd-viz)

| Primitive                                | Purpose                                                                 | Use when                                                                                                                                   |
| ---------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `<Panel>` + `.Header` + `.Body`          | Surface container. Variants: `solid`, `glass`, `ghost` × `depth` 0-3.   | You need a card, HUD, sidebar, or docked panel. Use `glass` for overlays on the scatter canvas.                                            |
| `<IconButton>`                           | Icon-only button with required tooltip (`label` + `description`).       | Toolbar icons, compact action buttons. Forces accessible labelling.                                                                        |
| `<ControlStrip>` + `.Group` + `.Divider` | Dense horizontal toolbar container.                                     | Top-of-panel toolbars with small grouped buttons. Skip if the strip has complex nested labels (see `ScatterControlStrip.tsx`).             |
| `<SliderRow>`                            | `[label] [slider] [value]` with density rungs and `formatValue`.        | Any controlled slider with a numeric readout. Skip if you need `defaultValue` + imperative perf (see `VolumeRow` in `VolumeControls.tsx`). |
| `<Callout>`                              | Tone-tinted banner. `tone`: `info` / `success` / `warning` / `danger`.  | Status banners, inline errors, filter-scope notices.                                                                                       |
| `<Pill>`                                 | Inline tone-tinted chip. Same tone vocabulary as Callout plus `muted`.  | Counts, selection markers, status words. Lighter sibling of shadcn's `<Badge>`.                                                            |
| `<KeyValueRow>`                          | `[label]: [value]` with truncating label column and tabular-nums value. | Metadata readouts, settings key-value lists.                                                                                               |
| `<DimensionBadge>`                       | Small technical label. `tone`: `obs` / `var` / `accent` / `muted`.      | Labeling categories, layer names, axis dimensions.                                                                                         |
| `<FilterBadge>`                          | Filtered/total count display with accent-cyan when filtered.            | Anywhere a filtered subset count is shown.                                                                                                 |
| `<LegendRow>`                            | Swatch + label + count with `disabled` / `dimmed` / `isolated` state.   | Categorical legends. Caller supplies the swatch (wrap it in ContextMenu if you need color-picking).                                        |

### Where things live outside `ui/`

| Component            | Location                                   | Why                                                                    |
| -------------------- | ------------------------------------------ | ---------------------------------------------------------------------- |
| `FloatingWindow`     | `components/FloatingWindow.tsx`            | Works well where it is. Could move to `ui/` later, no functional gain. |
| `CollapsibleOverlay` | `components/viewer/CollapsibleOverlay.tsx` | Viewer-specific interaction; kept with its consumers.                  |
| `StatusBar`          | `components/StatusBar.tsx`                 | Single-site consumer; not a reusable primitive.                        |

## Recipes (`lib/recipes.ts`)

Named strings of Tailwind classes for recurring patterns, composable via `cn()`. One step below CVA — no variants, just a stable bundle that call sites can reference so renaming a token propagates.

```tsx
import { glassSurface, focusRing } from "@/lib/recipes";
<div className={cn(glassSurface, "p-3")}>…</div>;
```

Exported: `focusRing`, `panelSurface`, `glassSurface`, `dataMono`.

## Migration notes

- **`<Panel variant="glass">` not inline `bg-card/80 border-white/[0.07] backdrop-blur-md`.** The inline string renders white-on-white in light mode; the Panel variant uses `--glass-*` tokens that swap correctly.
- **`<DimensionBadge>` not hand-rolled `<span className="border-*/30 bg-*/20 text-[9px]">`.** Every new color tone otherwise adds another one-off copy of the same structure.
- **`<IconButton>` not `HoverTip + <button size-[22px]>`.** Enforces `aria-label` and the 22/26 px density rungs.
- **`<Panel>` not `<Card>` on the canvas.** shadcn's `<Card>` targets docked sidebars and lacks a glass variant. Use `<Panel>` for floating overlays.
- **Named typography rungs (`text-2xs`, `text-3xs`) not arbitrary `text-[10px]` / `text-[11px]`.** Drift reintroduces unnamed sizes; reviewers should push back on arbitrary pixel sizes.

## Adding a new shadcn primitive

```bash
vp dlx shadcn@latest add dropdown-menu
```

Then:

1. Audit the generated file's colors — replace any `bg-background`-style tokens we've overridden if the component's defaults don't match our palette.
2. Add `data-slot` attributes on subparts if the generated code omits them (shadcn v4 convention; newer generators include them automatically).
3. If you're extending variants (e.g. a new `brand` tone on `Button`), edit the CVA block in place. Don't wrap the primitive in a second component to add variants — double the maintenance surface.
