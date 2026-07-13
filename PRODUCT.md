# PRODUCT.md — nd-embedding-atlas · Node Workspace

> Impeccable context file. Drop at repo root before running `/impeccable init`
> (init will confirm rather than interview), or paste these answers into the
> interview.
> Product and architecture terms follow [`VOCABULARY.md`](./VOCABULARY.md).

## Register

**Product surface.** A workflow tool — node-graph workspace for exploring
multi-million-row imaging/embedding atlases. The design's job is task
completion at high information density; the impression follows from
precision, not decoration.

## Who is this for

Computational biologists and imaging scientists at a research institute
(CZ Biohub) exploring single-cell embedding atlases: 2.4M+ observations,
UMAP scatters, microscopy FOVs, gated subpopulations. Expert users who live
in tools like Napari, CellProfiler, and notebooks; comfortable with
Houdini-class density; allergic to consumer-app hand-holding.

## Brand voice (three words)

**Precise · instrumental · calm.**

The UI talks like lab equipment telemetry: lowercase mono labels, bracketed
counts (`[2,418,309]`), epoch counters, LED states. It never exclaims.

## Visual references

- Houdini's network editor and TouchDesigner (graph density, flags, HUD)
- Teenage Engineering hardware panels (instrument signage, restrained LEDs)
- Vercel/Geist engineering aesthetic (Geist Mono carries ALL text —
  UI and data alike; Geist Pixel for HUD signage)
- Blackmagic camera OSD / avionics telemetry (the cook-state language)

## Anti-references

- Generic SaaS dashboards (Tailwind UI defaults, card grids with KPI tiles)
- n8n / Zapier consumer-automation node looks (fat rounded nodes, emoji)
- Neon cyberpunk / glassmorphism-for-its-own-sake
- Anything that puts gradients or marketing type inside the work surface

## Hard rules

- Dark theme is primary; tokens come from
  `apps/ndea/src/frontend/app.css` — never
  invent colors (periwinkle primary `oklch(0.554 0.236 281)`, wire colors:
  pred `#8b7bf7` / sel `#f59e0b` / focus `#38bdf8`)
- Telemetry is a feature, not noise — but it all sits behind one toggle
- `prefers-reduced-motion` collapses all motion (cursor morph, wire dashes,
  FLIP ghosts) to static states
- The graph document is the source of truth; every panel is a projection
