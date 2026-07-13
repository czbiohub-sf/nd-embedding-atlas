---
title: "nd-embedding-atlas: The atlas becomes an instrument"
type: presentation-blueprint
date: 2026-07-12
slides: 18
audience: "computational biologists, imaging scientists, engineers, and technical stakeholders"
tone: "precise, instrumental, calm"
source_digest: "18a6f9015906bc6b8a690febf015f279abb9fa430506645679829351f762b4f7"
sources:
  - "PRODUCT.md"
  - "DESIGN.md"
  - ".design/VOCABULARY.md"
  - "docs/plans/2026-07-11-001-refactor-vite-plus-monorepo-plan.md"
  - "docs/plans/2026-07-12-001-refactor-monorepo-terminology-standardization-plan.md"
  - "scripts/build-design-presentation.ts"
---

# nd-embedding-atlas — Holistic Design Presentation

**Format:** Self-contained 16:9 HTML presentation with offline assets, keyboard/touch navigation, deep links, presenter notes, print/PDF output, visible focus, semantic structure, and reduced-motion behavior.

**Narrative:** Scientific scale → product invariant → investigation workflow → interaction surfaces → typed graph execution → full system and monorepo → architectural inversion → OMP/Blender/Houdini synthesis → plugin contract and lifecycle → user-authored node assets → exact-version recovery and trust → dependency-ordered roadmap → product promise.

**Global visual system:** Geist Mono for every textual/data element; Geist Pixel for HUD signage only. Dark primary surface. Biohub periwinkle marks active state. Predicate, row-set, and focus wires use product purple, amber, and sky respectively. Layouts favor diagrams, rails, and technical topology over card grids.

## Slide 1 – The atlas becomes an instrument

**Purpose:** Open with the product thesis and establish the calm scientific-instrument register.

### Content

**Eyebrow:** “00 / premise”

**Headline:** “nd-embedding-atlas”

**Subheading:** “A node workspace connecting AI embeddings to source 5D imagery.”

**Exact bullets:**

- No bullets; the slide relies on its headline and diagram.

**Callout:** “from embedding → observation → pixels”

### Layout

Asymmetric 42/58 split. Identity and thesis on the left; a sparse typed-node graph fills the right two-thirds.

### Typography

- Headline: Geist Mono Variable, 46–64px equivalent, 620 weight, left or center aligned as specified by layout.
- Eyebrow/HUD labels: Geist Pixel, 10–12px, uppercase, 0.14em tracking.
- Body and annotations: Geist Mono Variable, 15–20px equivalent, 420–560 weight.
- Data, IDs, and code: Geist Mono Variable, tabular numerals, compact line height.

### Visual

Animated line-art node graph with predicate, selection, and focus wires. Nodes use the product’s card/chip geometry; no decorative illustration.

### Stylistic direction

Dark scientific-instrument surface. Use only the committed product palette: near-black periwinkle-tinted background, neutral graphite surfaces, Biohub periwinkle active state, typed-wire purple/amber/sky, teal clean state, and restrained error red. No gradients, generic card grid, glass decoration, marketing imagery, or ornamental motion.

### Transition

Reveal: begin at the product identity, then expose the graph as the mechanism.

### Accessibility

Maintain semantic reading order independent of the visual diagram. Diagram has an accessible label or SVG title/description. Body copy meets 4.5:1 contrast. Motion reduces to an instant state under `prefers-reduced-motion`.

### Speaker notes

Frame this as a scientific workflow instrument, not another analytics dashboard. The graph exists to preserve context across data representations.

---

## Slide 2 – The data is larger than one view

**Purpose:** Ground the architecture in the scientific scale and dimensionality it must handle.

### Content

**Eyebrow:** “01 / context”

**Headline:** “2.4M+ observations. 5D source imagery. One continuous investigation.”

**Subheading:** “Embedding coordinates summarize the atlas; TCZYX pixels preserve the evidence.”

**Exact bullets:**

- Millions of observations queried through server-side DuckDB
- UMAP and other embeddings rendered through WebGPU
- OME-Zarr crops resolved back to time, channel, depth, and pixels
- Annotations and Collections must survive every transition

**Callout:** “The hard problem is not drawing points. It is retaining identity across representations.”

### Layout

Large numeric statement on the left. A horizontal identity chain and compact evidence list occupy the right.

### Typography

- Headline: Geist Mono Variable, 46–64px equivalent, 620 weight, left or center aligned as specified by layout.
- Eyebrow/HUD labels: Geist Pixel, 10–12px, uppercase, 0.14em tracking.
- Body and annotations: Geist Mono Variable, 15–20px equivalent, 420–560 weight.
- Data, IDs, and code: Geist Mono Variable, tabular numerals, compact line height.

### Visual

Four-stage observation identity chain: embedding point, row index, observation name, source crop. Each stage uses a distinct glyph and label.

### Stylistic direction

Dark scientific-instrument surface. Use only the committed product palette: near-black periwinkle-tinted background, neutral graphite surfaces, Biohub periwinkle active state, typed-wire purple/amber/sky, teal clean state, and restrained error red. No gradients, generic card grid, glass decoration, marketing imagery, or ornamental motion.

### Transition

Escalation: move from product identity to the scale and identity problem that shapes every technical decision.

### Accessibility

Maintain semantic reading order independent of the visual diagram. Diagram has an accessible label or SVG title/description. Body copy meets 4.5:1 contrast. Motion reduces to an instant state under `prefers-reduced-motion`.

### Speaker notes

Emphasize that row index, observation identity, GPU point index, and image coordinates cannot collapse into one generic ID.

---

## Slide 3 – One document, many projections

**Purpose:** State the governing product invariant that unifies graph, panels, layout, and persistence.

### Content

**Eyebrow:** “02 / product”

**Headline:** “The graph document is the source of truth.”

**Subheading:** “Canvas, Stage, tiles, tables, charts, and image surfaces are projections—not competing state owners.”

**Exact bullets:**

- Workspace owns composition, layout, placement, coordination, and persistence
- Graph runtime evaluates the document without owning product layout
- Every Body mounts once, then moves between surfaces without remounting

**Callout:** “one authored graph → many synchronized views”

### Layout

Centered graph-document core. Canvas, Stage, Table, and Image Viewer sit around it as labeled projections.

### Typography

- Headline: Geist Mono Variable, 46–64px equivalent, 620 weight, left or center aligned as specified by layout.
- Eyebrow/HUD labels: Geist Pixel, 10–12px, uppercase, 0.14em tracking.
- Body and annotations: Geist Mono Variable, 15–20px equivalent, 420–560 weight.
- Data, IDs, and code: Geist Mono Variable, tabular numerals, compact line height.

### Visual

Hub-and-projection diagram with one purple graph document core and four neutral product surfaces. Bidirectional lines indicate projection and authored actions.

### Stylistic direction

Dark scientific-instrument surface. Use only the committed product palette: near-black periwinkle-tinted background, neutral graphite surfaces, Biohub periwinkle active state, typed-wire purple/amber/sky, teal clean state, and restrained error red. No gradients, generic card grid, glass decoration, marketing imagery, or ornamental motion.

### Transition

Resolve: convert the scale problem into one product invariant.

### Accessibility

Maintain semantic reading order independent of the visual diagram. Diagram has an accessible label or SVG title/description. Body copy meets 4.5:1 contrast. Motion reduces to an instant state under `prefers-reduced-motion`.

### Speaker notes

Use ‘Workspace’ only for the product composition owner. Do not call every graph or runtime object Workspace state.

---

## Slide 4 – Investigation stays continuous

**Purpose:** Show the end-to-end scientist workflow that the product architecture must preserve.

### Content

**Eyebrow:** “03 / workflow”

**Headline:** “Load → explore → gate → inspect → annotate → preserve”

**Subheading:** “Each action changes one contract while the rest of the investigation remains intact.”

**Exact bullets:**

- Open AnnData, MuData, or OME-Zarr-backed data
- Explore embeddings and linked distributions
- Create predicate or row-set evidence
- Focus an observation and inspect its image
- Write annotations or durable Collections
- Reopen the Workspace with topology and context intact

### Layout

Single horizontal six-step rail with compact evidence labels below. Avoid dashboard cards.

### Typography

- Headline: Geist Mono Variable, 46–64px equivalent, 620 weight, left or center aligned as specified by layout.
- Eyebrow/HUD labels: Geist Pixel, 10–12px, uppercase, 0.14em tracking.
- Body and annotations: Geist Mono Variable, 15–20px equivalent, 420–560 weight.
- Data, IDs, and code: Geist Mono Variable, tabular numerals, compact line height.

### Visual

Instrument timeline. Every stage has a numbered LED, verb, and one concrete artifact. Typed colored lines continue beneath the stages.

### Stylistic direction

Dark scientific-instrument surface. Use only the committed product palette: near-black periwinkle-tinted background, neutral graphite surfaces, Biohub periwinkle active state, typed-wire purple/amber/sky, teal clean state, and restrained error red. No gradients, generic card grid, glass decoration, marketing imagery, or ornamental motion.

### Transition

Demonstration: turn the product invariant into a concrete investigation path.

### Accessibility

Maintain semantic reading order independent of the visual diagram. Diagram has an accessible label or SVG title/description. Body copy meets 4.5:1 contrast. Motion reduces to an instant state under `prefers-reduced-motion`.

### Speaker notes

Selection is overloaded in ordinary language. Say predicate, row set, focus, Collection, or graph selection precisely.

---

## Slide 5 – Canvas composes. Stage concentrates. Body persists.

**Purpose:** Teach the product’s three primary surface nouns and the one-Body lifetime invariant.

### Content

**Eyebrow:** “04 / interaction”

**Headline:** “Three surfaces. One mounted node Body.”

**Subheading:** “Presentation changes; runtime identity does not.”

**Exact bullets:**

- Canvas: one graph editor with hierarchy and typed wires
- Stage: split composition for focused node Bodies
- Body: the live UI element owned by a node runtime
- Chip, card, and full forms express zoom-semantic detail

### Layout

Three vertical bands labeled Canvas, Stage, and Body, with one Body element visibly reparenting between surfaces.

### Typography

- Headline: Geist Mono Variable, 46–64px equivalent, 620 weight, left or center aligned as specified by layout.
- Eyebrow/HUD labels: Geist Pixel, 10–12px, uppercase, 0.14em tracking.
- Body and annotations: Geist Mono Variable, 15–20px equivalent, 420–560 weight.
- Data, IDs, and code: Geist Mono Variable, tabular numerals, compact line height.

### Visual

A Body outline appears once in the center and two directional arrows show adoption into Canvas and Stage sockets. Small chip/card/full silhouettes sit below.

### Stylistic direction

Dark scientific-instrument surface. Use only the committed product palette: near-black periwinkle-tinted background, neutral graphite surfaces, Biohub periwinkle active state, typed-wire purple/amber/sky, teal clean state, and restrained error red. No gradients, generic card grid, glass decoration, marketing imagery, or ornamental motion.

### Transition

Zoom-in: move from workflow to the interaction surfaces that carry it.

### Accessibility

Maintain semantic reading order independent of the visual diagram. Diagram has an accessible label or SVG title/description. Body copy meets 4.5:1 contrast. Motion reduces to an instant state under `prefers-reduced-motion`.

### Speaker notes

Do not describe Canvas ↔ Stage as remounting. DOM adoption protects React/WebGPU state and device leases.

---

## Slide 6 – The wires carry different evidence

**Purpose:** Explain the machine-level wire vocabulary and prevent overloaded selection language.

### Content

**Eyebrow:** “05 / graph”

**Headline:** “predicate · row set · focus”

**Subheading:** “Three typed channels; three distinct transition rules.”

**Exact bullets:**

- pred — pull-time SQL predicate; null means everything
- sel — authored row-set push; empty and absent remain different
- focus — one observation identity for cross-view inspection

**Callout:** “A lasso, a focused row, and selected graph nodes can coexist.”

### Layout

Three full-width wire lanes with ports, payload examples, and behavior labels. High horizontal rhythm.

### Typography

- Headline: Geist Mono Variable, 46–64px equivalent, 620 weight, left or center aligned as specified by layout.
- Eyebrow/HUD labels: Geist Pixel, 10–12px, uppercase, 0.14em tracking.
- Body and annotations: Geist Mono Variable, 15–20px equivalent, 420–560 weight.
- Data, IDs, and code: Geist Mono Variable, tabular numerals, compact line height.

### Visual

Purple circle predicate lane, amber square row-set lane, and blue diamond focus lane. Each terminates at a different node behavior.

### Stylistic direction

Dark scientific-instrument surface. Use only the committed product palette: near-black periwinkle-tinted background, neutral graphite surfaces, Biohub periwinkle active state, typed-wire purple/amber/sky, teal clean state, and restrained error red. No gradients, generic card grid, glass decoration, marketing imagery, or ornamental motion.

### Transition

Clarify: decompose ‘selection’ into the exact dataflow contracts.

### Accessibility

Maintain semantic reading order independent of the visual diagram. Diagram has an accessible label or SVG title/description. Body copy meets 4.5:1 contrast. Motion reduces to an instant state under `prefers-reduced-motion`.

### Speaker notes

Use `pred`, `sel`, and `focus` only as machine discriminants. Use full words in prose.

---

## Slide 7 – Push dirty. Pull cook. Stop at clean.

**Purpose:** Make the graph execution model legible and connect it to performance at atlas scale.

### Content

**Eyebrow:** “06 / execution”

**Headline:** “A lazy graph engine built for interactive evidence.”

**Subheading:** “Authored actions push invalidation; visible sinks pull only what they need.”

**Exact bullets:**

- markDirty propagates downstream and aborts superseded epochs
- pull walks upstream and halts at a valid cache boundary
- authored emissions bypass recooking of the source
- only mounted display-active sinks trigger work

**Callout:** “Closed views do not cook. Shared upstream nodes cook once per sweep.”

### Layout

Execution loop occupies the center. Four compact rules align on the right; epoch telemetry sits below.

### Typography

- Headline: Geist Mono Variable, 46–64px equivalent, 620 weight, left or center aligned as specified by layout.
- Eyebrow/HUD labels: Geist Pixel, 10–12px, uppercase, 0.14em tracking.
- Body and annotations: Geist Mono Variable, 15–20px equivalent, 420–560 weight.
- Data, IDs, and code: Geist Mono Variable, tabular numerals, compact line height.

### Visual

Circular push/pull flow with dirty amber, cooking periwinkle, and clean teal states. A cache node visibly stops traversal.

### Stylistic direction

Dark scientific-instrument surface. Use only the committed product palette: near-black periwinkle-tinted background, neutral graphite surfaces, Biohub periwinkle active state, typed-wire purple/amber/sky, teal clean state, and restrained error red. No gradients, generic card grid, glass decoration, marketing imagery, or ornamental motion.

### Transition

Mechanism: show how typed wires execute efficiently rather than merely connect visually.

### Accessibility

Maintain semantic reading order independent of the visual diagram. Diagram has an accessible label or SVG title/description. Body copy meets 4.5:1 contrast. Motion reduces to an instant state under `prefers-reduced-motion`.

### Speaker notes

This is a hybrid push-dirty/pull-cook engine. It remains framework-agnostic and value-generic.

---

## Slide 8 – Pixels stay near storage. Questions move.

**Purpose:** Explain the end-to-end browser/server/storage topology and why server-side analytics matter.

### Content

**Eyebrow:** “07 / system”

**Headline:** “One Bun process. One DuckDB connection. One browser workspace.”

**Subheading:** “Columnar queries cross the wire; multi-million-row datasets do not.”

**Exact bullets:**

- React + TypeGPU render the interactive workspace
- Mosaic queries share one WebSocket connection
- DuckDB owns analytical tables, selections, and preaggregations
- Custom Zarr I/O opens AnnData, MuData, and OME-Zarr
- Bun compiles the host and frontend into one distributable binary

### Layout

Layered topology: Browser, Bun host, analytical/storage plane. Arrows label protocol and payload type.

### Typography

- Headline: Geist Mono Variable, 46–64px equivalent, 620 weight, left or center aligned as specified by layout.
- Eyebrow/HUD labels: Geist Pixel, 10–12px, uppercase, 0.14em tracking.
- Body and annotations: Geist Mono Variable, 15–20px equivalent, 420–560 weight.
- Data, IDs, and code: Geist Mono Variable, tabular numerals, compact line height.

### Visual

Three horizontal system layers with a WebSocket query line, Arrow result line, crop request, and file-backed Zarr/DuckDB sources.

### Stylistic direction

Dark scientific-instrument surface. Use only the committed product palette: near-black periwinkle-tinted background, neutral graphite surfaces, Biohub periwinkle active state, typed-wire purple/amber/sky, teal clean state, and restrained error red. No gradients, generic card grid, glass decoration, marketing imagery, or ornamental motion.

### Transition

Expand: place the graph engine inside the complete application topology.

### Accessibility

Maintain semantic reading order independent of the visual diagram. Diagram has an accessible label or SVG title/description. Body copy meets 4.5:1 contrast. Motion reduces to an instant state under `prefers-reduced-motion`.

### Speaker notes

The product avoids browser memory ceilings. The REST query route remains a test/curl fallback; Mosaic uses WebSocket.

---

## Slide 9 – Package seams follow authority

**Purpose:** Show the monorepo target and the dependency direction that enables extensibility without fragmenting the product.

### Content

**Eyebrow:** “08 / ownership”

**Headline:** “A private workspace with four earned product boundaries.”

**Subheading:** “The app composes; leaf packages define contracts and scientific I/O.”

**Exact bullets:**

- @ndea/protocol — serialized HTTP, WebSocket, and plugin wire schemas
- @ndea/sdk — plugin and node-author contracts
- @ndea/zarr — Bun/Zarrita scientific storage I/O
- @ndea/app — the only deployable product composition
- docs — isolated Waku deployment outside the product workspace

**Callout:** “Dependency arrows point inward. No package imports the app.”

### Layout

Dependency topology centered on @ndea/app, with three leaf packages below and docs separated by a boundary rule.

### Typography

- Headline: Geist Mono Variable, 46–64px equivalent, 620 weight, left or center aligned as specified by layout.
- Eyebrow/HUD labels: Geist Pixel, 10–12px, uppercase, 0.14em tracking.
- Body and annotations: Geist Mono Variable, 15–20px equivalent, 420–560 weight.
- Data, IDs, and code: Geist Mono Variable, tabular numerals, compact line height.

### Visual

Architectural package diagram with directional arrows and one highlighted single-binary output.

### Stylistic direction

Dark scientific-instrument surface. Use only the committed product palette: near-black periwinkle-tinted background, neutral graphite surfaces, Biohub periwinkle active state, typed-wire purple/amber/sky, teal clean state, and restrained error red. No gradients, generic card grid, glass decoration, marketing imagery, or ornamental motion.

### Transition

Partition: convert system layers into maintainable ownership boundaries.

### Accessibility

Maintain semantic reading order independent of the visual diagram. Diagram has an accessible label or SVG title/description. Body copy meets 4.5:1 contrast. Motion reduces to an instant state under `prefers-reduced-motion`.

### Speaker notes

This is not a micro-package exercise. Each seam exists because it has a stable independent consumer or contract.

---

## Slide 10 – Workspace should compose nodes—not define them

**Purpose:** Name the current architectural inversion and the clean target without turning the slide into a code inventory.

### Content

**Eyebrow:** “09 / refactor”

**Headline:** “Move ownership before changing spelling.”

**Subheading:** “The refactor deletes parallel authorities instead of renaming them.”

**Exact bullets:**

- Today: Workspace-prefixed graph types leak into every built-in node
- Today: graph specs and lazy descriptors merge as conflicting halves
- Today: Dashboard host services are replaced by a Workspace Proxy
- Target: SDK → graph/plugin/node core → Workspace → Canvas/Stage

**Callout:** “One definition. One catalog. One host path. One Body lifetime.”

### Layout

Before/after dependency paths separated by a vertical cut line. Deletions sit on the cut, not in a third compatibility layer.

### Typography

- Headline: Geist Mono Variable, 46–64px equivalent, 620 weight, left or center aligned as specified by layout.
- Eyebrow/HUD labels: Geist Pixel, 10–12px, uppercase, 0.14em tracking.
- Body and annotations: Geist Mono Variable, 15–20px equivalent, 420–560 weight.
- Data, IDs, and code: Geist Mono Variable, tabular numerals, compact line height.

### Visual

Left tangled path with crossed dual authorities; right clean one-way dependency chain.

### Stylistic direction

Dark scientific-instrument surface. Use only the committed product palette: near-black periwinkle-tinted background, neutral graphite surfaces, Biohub periwinkle active state, typed-wire purple/amber/sky, teal clean state, and restrained error red. No gradients, generic card grid, glass decoration, marketing imagery, or ornamental motion.

### Transition

Contrast: expose why the existing package seams are insufficient for real plugins.

### Accessibility

Maintain semantic reading order independent of the visual diagram. Diagram has an accessible label or SVG title/description. Body copy meets 4.5:1 contrast. Motion reduces to an instant state under `prefers-reduced-motion`.

### Speaker notes

The plan removes Ws-prefixed reusable contracts, NodeDef projections, dual registration, host Proxy, and obsolete runtime IDs after migrations.

---

## Slide 11 – Borrow the right behavior from three systems

**Purpose:** Explain the synthesis behind the custom-node and plugin architecture.

### Content

**Eyebrow:** “10 / extensibility”

**Headline:** “OMP runtime discipline + Blender packaging + DCC node assets”

**Subheading:** “No source is copied wholesale; each solves a different layer.”

**Exact bullets:**

- OMP: registration-only factory, discovery/loading separation, source-aware failures
- Blender: manifest, validation, stable IDs and labels, register/unregister
- Houdini + Blender: definitions versus instances, node groups, libraries, exact versions

**Callout:** “Executable plugins add primitives. Declarative node assets let users compose new tools.”

### Layout

Three aligned source columns converge into one NDEA model at the bottom. Equal weight; no decorative logo treatment.

### Typography

- Headline: Geist Mono Variable, 46–64px equivalent, 620 weight, left or center aligned as specified by layout.
- Eyebrow/HUD labels: Geist Pixel, 10–12px, uppercase, 0.14em tracking.
- Body and annotations: Geist Mono Variable, 15–20px equivalent, 420–560 weight.
- Data, IDs, and code: Geist Mono Variable, tabular numerals, compact line height.

### Visual

Three technical pattern streams labeled OMP, Blender, and Houdini/DCC merging into Plugin → Node Definition → Node Asset.

### Stylistic direction

Dark scientific-instrument surface. Use only the committed product palette: near-black periwinkle-tinted background, neutral graphite surfaces, Biohub periwinkle active state, typed-wire purple/amber/sky, teal clean state, and restrained error red. No gradients, generic card grid, glass decoration, marketing imagery, or ornamental motion.

### Transition

Synthesis: answer the coupling problem with a proven but deliberately narrow extension model.

### Accessibility

Maintain semantic reading order independent of the visual diagram. Diagram has an accessible label or SVG title/description. Body copy meets 4.5:1 contrast. Motion reduces to an instant state under `prefers-reduced-motion`.

### Speaker notes

Keep V1 to trusted client custom nodes. Do not prebuild commands, panels, themes, server hooks, or a marketplace.

---

## Slide 12 – Inspect first. Execute second.

**Purpose:** Describe the plugin package contract and the strict boundary between wire schema, author API, and app catalog.

### Content

**Eyebrow:** “11 / plugin contract”

**Headline:** “One manifest. One factory. One atomic contribution batch.”

**Subheading:** “Plugin metadata is readable before trusted code executes.”

**Exact bullets:**

- Protocol owns manifest, bootstrap, and diagnostics schemas
- SDK owns PluginFactory, PluginAPI, NodeDefinition, NodeModule, and NodeHost
- External node IDs stay inside `${pluginId}/*`
- A failed factory commits no partial definitions

**Callout:** “registerNode(definition) is the entire V1 PluginAPI.”

### Layout

Manifest code specimen on the left; factory/API flow on the right. One catalog commit line spans the bottom.

### Typography

- Headline: Geist Mono Variable, 46–64px equivalent, 620 weight, left or center aligned as specified by layout.
- Eyebrow/HUD labels: Geist Pixel, 10–12px, uppercase, 0.14em tracking.
- Body and annotations: Geist Mono Variable, 15–20px equivalent, 420–560 weight.
- Data, IDs, and code: Geist Mono Variable, tabular numerals, compact line height.

### Visual

Compact TOML-like manifest and TypeScript-like factory specimen rendered as instrument readouts, not editor screenshots.

### Stylistic direction

Dark scientific-instrument surface. Use only the committed product palette: near-black periwinkle-tinted background, neutral graphite surfaces, Biohub periwinkle active state, typed-wire purple/amber/sky, teal clean state, and restrained error red. No gradients, generic card grid, glass decoration, marketing imagery, or ornamental motion.

### Transition

Specification: move from inspiration to the exact public seam.

### Accessibility

Maintain semantic reading order independent of the visual diagram. Diagram has an accessible label or SVG title/description. Body copy meets 4.5:1 contrast. Motion reduces to an instant state under `prefers-reduced-motion`.

### Speaker notes

Manifest version, plugin version, SDK range, node type version, config version, asset version, and document version remain distinct.

---

## Slide 13 – The catalog freezes before the Workspace wakes

**Purpose:** Make plugin bootstrap ordering and isolation explicit.

### Content

**Eyebrow:** “12 / bootstrap”

**Headline:** “discover → validate → import → collect → freeze → restore → mount → dispose”

**Subheading:** “Live node instances never observe half-registered state.”

**Exact bullets:**

- Server scans configured project and user roots once at startup
- Approved self-contained ESM and assets receive same-origin URLs
- Browser collects each plugin in an isolated registration batch
- Workspace loads exact refs only after the catalog freezes
- Disposal runs node instances before plugin registrations

**Callout:** “One failed plugin yields diagnostics and unresolved nodes—not an empty Workspace.”

### Layout

Eight-step bootstrap rail across the slide with error isolation branching below validate/import/collect.

### Typography

- Headline: Geist Mono Variable, 46–64px equivalent, 620 weight, left or center aligned as specified by layout.
- Eyebrow/HUD labels: Geist Pixel, 10–12px, uppercase, 0.14em tracking.
- Body and annotations: Geist Mono Variable, 15–20px equivalent, 420–560 weight.
- Data, IDs, and code: Geist Mono Variable, tabular numerals, compact line height.

### Visual

Sequential lifecycle with a green frozen-catalog gate; a red diagnostic branch returns to the main flow as unresolved preservation.

### Stylistic direction

Dark scientific-instrument surface. Use only the committed product palette: near-black periwinkle-tinted background, neutral graphite surfaces, Biohub periwinkle active state, typed-wire purple/amber/sky, teal clean state, and restrained error red. No gradients, generic card grid, glass decoration, marketing imagery, or ornamental motion.

### Transition

Sequence: show how the public contract becomes a deterministic session.

### Accessibility

Maintain semantic reading order independent of the visual diagram. Diagram has an accessible label or SVG title/description. Body copy meets 4.5:1 contrast. Motion reduces to an instant state under `prefers-reduced-motion`.

### Speaker notes

Enable, disable, and reload build a new session catalog in V1. Production never mutates a live catalog.

---

## Slide 14 – One definition; one runtime per instance

**Purpose:** Explain the custom-node author model and framework-neutral Body boundary.

### Content

**Eyebrow:** “13 / node authoring”

**Headline:** “Definition is static. Module is lazy. Host is scoped. Body is owned.”

**Subheading:** “Built-ins and plugins use the same validator and runtime path.”

**Exact bullets:**

- NodeDefinition: exact identity, ports, config, capabilities, evaluation, hints
- NodeModule: lazy runtime and Body factories
- NodeHost: capability-gated data, coordination, UI, GPU, and config services
- Mounted Body: one HTMLElement plus idempotent disposal

**Callout:** “React leaves the SDK. A plugin may own React, Web Components, Canvas, or another framework inside its Body.”

### Layout

Four-part contract anatomy around one node instance, with static/lazy/scoped/owned labels.

### Typography

- Headline: Geist Mono Variable, 46–64px equivalent, 620 weight, left or center aligned as specified by layout.
- Eyebrow/HUD labels: Geist Pixel, 10–12px, uppercase, 0.14em tracking.
- Body and annotations: Geist Mono Variable, 15–20px equivalent, 420–560 weight.
- Data, IDs, and code: Geist Mono Variable, tabular numerals, compact line height.

### Visual

Definition flows into module; module creates runtime and Body; host surrounds only the live instance.

### Stylistic direction

Dark scientific-instrument surface. Use only the committed product palette: near-black periwinkle-tinted background, neutral graphite surfaces, Biohub periwinkle active state, typed-wire purple/amber/sky, teal clean state, and restrained error red. No gradients, generic card grid, glass decoration, marketing imagery, or ornamental motion.

### Transition

Anatomy: zoom from the session lifecycle into one custom node.

### Accessibility

Maintain semantic reading order independent of the visual diagram. Diagram has an accessible label or SVG title/description. Body copy meets 4.5:1 contrast. Motion reduces to an instant state under `prefers-reduced-motion`.

### Speaker notes

The app can keep React adapters for built-ins while the public SDK remains framework-neutral.

---

## Slide 15 – Users can turn a working graph into a new tool

**Purpose:** Introduce declarative node assets as the non-code extensibility tier.

### Content

**Eyebrow:** “14 / user authoring”

**Headline:** “Select a subgraph. Promote its interface. Publish a versioned node asset.”

**Subheading:** “Node assets reuse graph behavior without embedding executable plugin code.”

**Exact bullets:**

- Promoted input/output ports and parameter bindings define the public interface
- Stable local inner IDs compile to outer-instance-scoped runtime IDs
- Assets can link from user/project libraries or embed for portability
- Nested assets are valid; direct or indirect recursion is rejected
- Existing instances remain pinned when a new version is published

**Callout:** “Use asset ≠ edit definition ≠ publish new version.”

### Layout

Before-and-after graph transformation: three-node subgraph becomes one named asset with exposed ports. Version/library controls sit below.

### Typography

- Headline: Geist Mono Variable, 46–64px equivalent, 620 weight, left or center aligned as specified by layout.
- Eyebrow/HUD labels: Geist Pixel, 10–12px, uppercase, 0.14em tracking.
- Body and annotations: Geist Mono Variable, 15–20px equivalent, 420–560 weight.
- Data, IDs, and code: Geist Mono Variable, tabular numerals, compact line height.

### Visual

Purple selection boundary around an inner graph, compression arrow, then one asset node with two promoted inputs and one output.

### Stylistic direction

Dark scientific-instrument surface. Use only the committed product palette: near-black periwinkle-tinted background, neutral graphite surfaces, Biohub periwinkle active state, typed-wire purple/amber/sky, teal clean state, and restrained error red. No gradients, generic card grid, glass decoration, marketing imagery, or ornamental motion.

### Transition

Empowerment: move from developer-authored primitives to scientist-authored reusable tools.

### Accessibility

Maintain semantic reading order independent of the visual diagram. Diagram has an accessible label or SVG title/description. Body copy meets 4.5:1 contrast. Motion reduces to an instant state under `prefers-reduced-motion`.

### Speaker notes

The current Subnet can seed the authoring UI, but its persisted proxy seams must not become the public asset format.

---

## Slide 16 – Missing code must never become missing science

**Purpose:** Unify exact versioning, migration, recovery, and trusted-code posture.

### Content

**Eyebrow:** “15 / safety”

**Headline:** “Preserve first. Diagnose second. Recover explicitly.”

**Subheading:** “No plugin failure, future document, or config migration may seed over user work.”

**Exact bullets:**

- Persist exact node type and asset versions—not ‘latest’
- Migrate config before creating runtime or mounting a Body
- Render unresolved placeholders for missing or incompatible definitions
- Keep raw bytes and versioned backups across document rewrites
- Treat V1 plugins as trusted same-origin code; permissions disclose intent, not sandboxing

**Callout:** “Unavailable is a recoverable state—not a reason to delete a node.”

### Layout

Central preserved graph record with four failure states around it and one recovery path returning to resolved runtime.

### Typography

- Headline: Geist Mono Variable, 46–64px equivalent, 620 weight, left or center aligned as specified by layout.
- Eyebrow/HUD labels: Geist Pixel, 10–12px, uppercase, 0.14em tracking.
- Body and annotations: Geist Mono Variable, 15–20px equivalent, 420–560 weight.
- Data, IDs, and code: Geist Mono Variable, tabular numerals, compact line height.

### Visual

State machine: resolved, unresolved, migrating, recovery. Raw record remains constant at the center.

### Stylistic direction

Dark scientific-instrument surface. Use only the committed product palette: near-black periwinkle-tinted background, neutral graphite surfaces, Biohub periwinkle active state, typed-wire purple/amber/sky, teal clean state, and restrained error red. No gradients, generic card grid, glass decoration, marketing imagery, or ornamental motion.

### Transition

Guardrail: show how extensibility preserves scientific work instead of increasing fragility.

### Accessibility

Maintain semantic reading order independent of the visual diagram. Diagram has an accessible label or SVG title/description. Body copy meets 4.5:1 contrast. Motion reduces to an instant state under `prefers-reduced-motion`.

### Speaker notes

Only a confirmed storage miss may seed a default Workspace. Invalid, future, read-failed, backup-failed, and rewrite-failed states suppress autosave.

---

## Slide 17 – Refactor in dependency order

**Purpose:** Compress the 23-unit plan into a legible implementation sequence and show why sequencing protects user data.

### Content

**Eyebrow:** “16 / execution”

**Headline:** “Contract first. Runtime second. Persistence after proof.”

**Subheading:** “Cleanup and communication close the work only after behavior holds.”

**Exact bullets:**

- 1 — vocabulary, protocol, scientific/storage characterization
- 2 — SDK, graph extraction, immutable catalog
- 3 — interaction, node UI, host/runtime, Workspace narrowing
- 4 — exact persistence, plugin bootstrap, node assets
- 5 — author example, UI language, HTML presentation, final gates

**Callout:** “No durable migration lands before its canonical runtime exists.”

### Layout

Five horizontal tracks with unit IDs, dependency gates, and one highlighted data-safety checkpoint.

### Typography

- Headline: Geist Mono Variable, 46–64px equivalent, 620 weight, left or center aligned as specified by layout.
- Eyebrow/HUD labels: Geist Pixel, 10–12px, uppercase, 0.14em tracking.
- Body and annotations: Geist Mono Variable, 15–20px equivalent, 420–560 weight.
- Data, IDs, and code: Geist Mono Variable, tabular numerals, compact line height.

### Visual

Instrument timeline with phase labels and a guarded migration gate between runtime and persistence tracks.

### Stylistic direction

Dark scientific-instrument surface. Use only the committed product palette: near-black periwinkle-tinted background, neutral graphite surfaces, Biohub periwinkle active state, typed-wire purple/amber/sky, teal clean state, and restrained error red. No gradients, generic card grid, glass decoration, marketing imagery, or ornamental motion.

### Transition

Commitment: turn architectural intent into an ordered, reviewable delivery path.

### Accessibility

Maintain semantic reading order independent of the visual diagram. Diagram has an accessible label or SVG title/description. Body copy meets 4.5:1 contrast. Motion reduces to an instant state under `prefers-reduced-motion`.

### Speaker notes

U8 remains a retired historical ID. Preserve stable unit IDs rather than renumbering the plan.

---

## Slide 18 – Context is the product

**Purpose:** Close on the user value that all architectural decisions protect.

### Content

**Eyebrow:** “17 / promise”

**Headline:** “From embedding to source image—without losing context.”

**Subheading:** “A precise instrument for exploring, explaining, and extending imaging atlases.”

**Exact bullets:**

- One graph document
- Typed evidence flow
- Exact scientific identity
- Extensible primitives and user-authored tools
- Recoverable durable work

**Callout:** “nd-embedding-atlas / Node Workspace”

### Layout

Large closing statement on the left; a resolved graph-to-image signal line on the right. Minimal final slide.

### Typography

- Headline: Geist Mono Variable, 46–64px equivalent, 620 weight, left or center aligned as specified by layout.
- Eyebrow/HUD labels: Geist Pixel, 10–12px, uppercase, 0.14em tracking.
- Body and annotations: Geist Mono Variable, 15–20px equivalent, 420–560 weight.
- Data, IDs, and code: Geist Mono Variable, tabular numerals, compact line height.

### Visual

A single periwinkle predicate wire becomes an amber row set, then a blue focus line terminating in a pixel crop frame.

### Stylistic direction

Dark scientific-instrument surface. Use only the committed product palette: near-black periwinkle-tinted background, neutral graphite surfaces, Biohub periwinkle active state, typed-wire purple/amber/sky, teal clean state, and restrained error red. No gradients, generic card grid, glass decoration, marketing imagery, or ornamental motion.

### Transition

Summary: return to the opening graph with the full meaning of each connection now established.

### Accessibility

Maintain semantic reading order independent of the visual diagram. Diagram has an accessible label or SVG title/description. Body copy meets 4.5:1 contrast. Motion reduces to an instant state under `prefers-reduced-motion`.

### Speaker notes

End without a generic call to action. The promise is continuity of scientific context and the ability to extend the instrument deliberately.
