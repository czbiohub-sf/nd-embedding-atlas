#!/usr/bin/env bun

import { mkdirSync } from "node:fs";
import { relative, resolve } from "node:path";

interface Slide {
  id: string;
  chapter: string;
  title: string;
  purpose: string;
  headline: string;
  subheading?: string;
  bullets?: readonly string[];
  callout?: string;
  layout: string;
  visual: string;
  transition: string;
  notes: string;
  body: string;
}

const ROOT = resolve(import.meta.dir, "..");
const OUTPUT_DIR = resolve(ROOT, "docs/presentations");
const BLUEPRINT_PATH = resolve(OUTPUT_DIR, "ndea-design-presentation.md");
const HTML_PATH = resolve(OUTPUT_DIR, "ndea-design-presentation.html");
const CHECK = Bun.argv.includes("--check");

const SOURCE_PATHS = [
  resolve(ROOT, "PRODUCT.md"),
  resolve(ROOT, "DESIGN.md"),
  resolve(ROOT, ".design/VOCABULARY.md"),
  resolve(ROOT, "docs/plans/2026-07-11-001-refactor-vite-plus-monorepo-plan.md"),
  resolve(ROOT, "docs/plans/2026-07-12-001-refactor-monorepo-terminology-standardization-plan.md"),
  import.meta.path,
] as const;

const slides: readonly Slide[] = [
  {
    id: "opening",
    chapter: "00 / premise",
    title: "The atlas becomes an instrument",
    purpose: "Open with the product thesis and establish the calm scientific-instrument register.",
    headline: "nd-embedding-atlas",
    subheading: "A node workspace connecting AI embeddings to source 5D imagery.",
    callout: "from embedding → observation → pixels",
    layout:
      "Asymmetric 42/58 split. Identity and thesis on the left; a sparse typed-node graph fills the right two-thirds.",
    visual:
      "Animated line-art node graph with predicate, selection, and focus wires. Nodes use the product’s card/chip geometry; no decorative illustration.",
    transition: "Reveal: begin at the product identity, then expose the graph as the mechanism.",
    notes:
      "Frame this as a scientific workflow instrument, not another analytics dashboard. The graph exists to preserve context across data representations.",
    body: `
            <div class="hero-copy">
                <p class="kicker hud">NODE WORKSPACE / BIOIMAGING</p>
                <h2>nd-embedding-<br><span>atlas</span></h2>
                <p class="lede">A node workspace connecting AI embeddings to source 5D imagery.</p>
                <p class="signal-line"><span></span>from embedding → observation → pixels</p>
            </div>
            <div class="hero-graph" aria-label="Typed node graph joining atlas data, scatter selection, image inspection, and annotation">
                <svg viewBox="0 0 720 500" role="img" aria-labelledby="opening-graph-title opening-graph-desc">
                    <title id="opening-graph-title">The nd-embedding-atlas node graph</title>
                    <desc id="opening-graph-desc">Dataset and scatter nodes flow through typed predicate, selection, and focus wires to image inspection and annotation.</desc>
                    <path class="wire pred moving" d="M154 128 C260 128 214 238 326 238"/>
                    <path class="wire sel moving" d="M420 252 C522 252 470 378 580 378"/>
                    <path class="wire focus moving" d="M420 226 C530 226 488 104 584 104"/>
                    <path class="wire pred quiet" d="M154 152 C254 152 232 400 340 400"/>
                    <g class="svg-node" transform="translate(34 95)"><rect width="120" height="72"/><circle class="led clean" cx="14" cy="15" r="4"/><text x="26" y="19">dataset</text><text class="meta" x="14" y="50">[2,418,309]</text><circle class="port pred" cx="120" cy="33" r="5"/></g>
                    <g class="svg-node selected" transform="translate(326 194)"><rect width="94" height="72"/><circle class="led clean" cx="14" cy="15" r="4"/><text x="26" y="19">scatter</text><text class="meta" x="14" y="50">umap</text><circle class="port pred" cx="0" cy="44" r="5"/><rect class="port sel" x="90" y="54" width="9" height="9"/><path class="port focus" d="M94 23 l6 6 -6 6 -6-6z"/></g>
                    <g class="svg-node" transform="translate(584 70)"><rect width="104" height="72"/><circle class="led dirty" cx="14" cy="15" r="4"/><text x="26" y="19">image</text><text class="meta" x="14" y="50">TCZYX</text><path class="port focus" d="M0 28 l6 6 -6 6 -6-6z"/></g>
                    <g class="svg-node" transform="translate(580 344)"><rect width="108" height="72"/><circle class="led clean" cx="14" cy="15" r="4"/><text x="26" y="19">annotate</text><text class="meta" x="14" y="50">collection</text><rect class="port sel" x="-5" y="29" width="9" height="9"/></g>
                    <g class="svg-node chip" transform="translate(340 378)"><rect width="94" height="42" rx="21"/><text x="17" y="26">cache</text><circle class="port pred" cx="0" cy="21" r="5"/></g>
                </svg>
            </div>`,
  },
  {
    id: "scale",
    chapter: "01 / context",
    title: "The data is larger than one view",
    purpose: "Ground the architecture in the scientific scale and dimensionality it must handle.",
    headline: "2.4M+ observations. 5D source imagery. One continuous investigation.",
    subheading: "Embedding coordinates summarize the atlas; TCZYX pixels preserve the evidence.",
    bullets: [
      "Millions of observations queried through server-side DuckDB",
      "UMAP and other embeddings rendered through WebGPU",
      "OME-Zarr crops resolved back to time, channel, depth, and pixels",
      "Annotations and Collections must survive every transition",
    ],
    callout: "The hard problem is not drawing points. It is retaining identity across representations.",
    layout:
      "Large numeric statement on the left. A horizontal identity chain and compact evidence list occupy the right.",
    visual:
      "Four-stage observation identity chain: embedding point, row index, observation name, source crop. Each stage uses a distinct glyph and label.",
    transition:
      "Escalation: move from product identity to the scale and identity problem that shapes every technical decision.",
    notes:
      "Emphasize that row index, observation identity, GPU point index, and image coordinates cannot collapse into one generic ID.",
    body: `
            <div class="metric-stage">
                <div class="mega"><span>2.4M+</span><small>observations</small></div>
                <div class="dimension-stack" aria-label="Five source image dimensions"><b>T</b><b>C</b><b>Z</b><b>Y</b><b>X</b></div>
            </div>
            <div class="identity-stage">
                <p class="section-lede">Embedding coordinates summarize the atlas; source pixels preserve the evidence.</p>
                <div class="identity-chain">
                    <div><span class="identity-mark point"></span><small>GPU POINT</small><strong>visual mark</strong></div>
                    <i>→</i>
                    <div><span class="identity-mark row">42</span><small>ROW INDEX</small><strong>live routing</strong></div>
                    <i>→</i>
                    <div><span class="identity-mark obs">A17</span><small>OBS NAME</small><strong>durable identity</strong></div>
                    <i>→</i>
                    <div><span class="identity-mark crop"></span><small>TCZYX CROP</small><strong>source evidence</strong></div>
                </div>
                <ul class="evidence-list"><li>DuckDB query plane</li><li>WebGPU scatter</li><li>OME-Zarr crop</li><li>durable annotation</li></ul>
                <blockquote>The hard problem is not drawing points. It is retaining identity across representations.</blockquote>
            </div>`,
  },
  {
    id: "thesis",
    chapter: "02 / product",
    title: "One document, many projections",
    purpose: "State the governing product invariant that unifies graph, panels, layout, and persistence.",
    headline: "The graph document is the source of truth.",
    subheading: "Canvas, Stage, tiles, tables, charts, and image surfaces are projections—not competing state owners.",
    bullets: [
      "Workspace owns composition, layout, placement, coordination, and persistence",
      "Graph runtime evaluates the document without owning product layout",
      "Every Body mounts once, then moves between surfaces without remounting",
    ],
    callout: "one authored graph → many synchronized views",
    layout:
      "Centered graph-document core. Canvas, Stage, Table, and Image Viewer sit around it as labeled projections.",
    visual:
      "Hub-and-projection diagram with one purple graph document core and four neutral product surfaces. Bidirectional lines indicate projection and authored actions.",
    transition: "Resolve: convert the scale problem into one product invariant.",
    notes:
      "Use ‘Workspace’ only for the product composition owner. Do not call every graph or runtime object Workspace state.",
    body: `
            <div class="thesis-copy"><h2>The graph document<br><span>is the source of truth.</span></h2><p>Every surface is a projection.</p></div>
            <div class="projection-map" aria-label="Workspace graph document projected into Canvas, Stage, Table, and Image Viewer">
                <svg viewBox="0 0 720 420" role="img">
                    <path d="M360 188 L142 82"/><path d="M360 188 L578 82"/><path d="M360 228 L142 336"/><path d="M360 228 L578 336"/>
                    <g class="projection core" transform="translate(266 154)"><rect width="188" height="112"/><text x="94" y="47">GRAPH DOCUMENT</text><text class="meta" x="94" y="72">topology · config · refs</text></g>
                    <g class="projection" transform="translate(44 34)"><rect width="196" height="86"/><text x="98" y="40">CANVAS</text><text class="meta" x="98" y="61">wiring + hierarchy</text></g>
                    <g class="projection" transform="translate(480 34)"><rect width="196" height="86"/><text x="98" y="40">STAGE</text><text class="meta" x="98" y="61">focused Bodies</text></g>
                    <g class="projection" transform="translate(44 296)"><rect width="196" height="86"/><text x="98" y="40">TABLE</text><text class="meta" x="98" y="61">rows + focus</text></g>
                    <g class="projection" transform="translate(480 296)"><rect width="196" height="86"/><text x="98" y="40">IMAGE VIEWER</text><text class="meta" x="98" y="61">source pixels</text></g>
                </svg>
            </div>`,
  },
  {
    id: "workflow",
    chapter: "03 / workflow",
    title: "Investigation stays continuous",
    purpose: "Show the end-to-end scientist workflow that the product architecture must preserve.",
    headline: "Load → explore → gate → inspect → annotate → preserve",
    subheading: "Each action changes one contract while the rest of the investigation remains intact.",
    bullets: [
      "Open AnnData, MuData, or OME-Zarr-backed data",
      "Explore embeddings and linked distributions",
      "Create predicate or row-set evidence",
      "Focus an observation and inspect its image",
      "Write annotations or durable Collections",
      "Reopen the Workspace with topology and context intact",
    ],
    layout: "Single horizontal six-step rail with compact evidence labels below. Avoid dashboard cards.",
    visual:
      "Instrument timeline. Every stage has a numbered LED, verb, and one concrete artifact. Typed colored lines continue beneath the stages.",
    transition: "Demonstration: turn the product invariant into a concrete investigation path.",
    notes:
      "Selection is overloaded in ordinary language. Say predicate, row set, focus, Collection, or graph selection precisely.",
    body: `
            <div class="workflow-rail">
                <div class="workflow-step"><b>01</b><span>load</span><small>AnnData / MuData</small></div>
                <div class="workflow-step"><b>02</b><span>explore</span><small>UMAP + charts</small></div>
                <div class="workflow-step pred-step"><b>03</b><span>gate</span><small>predicate / row set</small></div>
                <div class="workflow-step focus-step"><b>04</b><span>inspect</span><small>focused observation</small></div>
                <div class="workflow-step sel-step"><b>05</b><span>annotate</span><small>Collection / column</small></div>
                <div class="workflow-step"><b>06</b><span>preserve</span><small>versioned Workspace</small></div>
            </div>
            <div class="workflow-wires"><span class="pred-line"></span><span class="sel-line"></span><span class="focus-line"></span></div>
            <p class="center-callout">Each action changes one contract. The investigation remains intact.</p>`,
  },
  {
    id: "surfaces",
    chapter: "04 / interaction",
    title: "Canvas composes. Stage concentrates. Body persists.",
    purpose: "Teach the product’s three primary surface nouns and the one-Body lifetime invariant.",
    headline: "Three surfaces. One mounted node Body.",
    subheading: "Presentation changes; runtime identity does not.",
    bullets: [
      "Canvas: one graph editor with hierarchy and typed wires",
      "Stage: split composition for focused node Bodies",
      "Body: the live UI element owned by a node runtime",
      "Chip, card, and full forms express zoom-semantic detail",
    ],
    layout:
      "Three vertical bands labeled Canvas, Stage, and Body, with one Body element visibly reparenting between surfaces.",
    visual:
      "A Body outline appears once in the center and two directional arrows show adoption into Canvas and Stage sockets. Small chip/card/full silhouettes sit below.",
    transition: "Zoom-in: move from workflow to the interaction surfaces that carry it.",
    notes: "Do not describe Canvas ↔ Stage as remounting. DOM adoption protects React/WebGPU state and device leases.",
    body: `
            <div class="surface-system">
                <div class="surface canvas-surface"><p class="hud">CANVAS</p><strong>compose</strong><small>wiring · hierarchy · placement</small><div class="surface-slot"></div></div>
                <div class="body-core"><span class="led clean"></span><p class="hud">BODY</p><strong>persists</strong><small>one mounted element</small><div class="body-signature">host · runtime · device</div></div>
                <div class="surface stage-surface"><p class="hud">STAGE</p><strong>concentrate</strong><small>split · tile · compare</small><div class="surface-slot"></div></div>
                <svg class="adoption-arrows" viewBox="0 0 1000 260" aria-hidden="true"><path d="M430 130 C340 130 330 180 250 180"/><path d="M570 130 C660 130 670 180 750 180"/></svg>
            </div>
            <div class="forms"><div class="form-chip">chip</div><div class="form-card"><i></i><span>card</span></div><div class="form-full"><i></i><span>full Body</span></div><p>zoom-semantic form, unchanged runtime</p></div>`,
  },
  {
    id: "wires",
    chapter: "05 / graph",
    title: "The wires carry different evidence",
    purpose: "Explain the machine-level wire vocabulary and prevent overloaded selection language.",
    headline: "predicate · row set · focus",
    subheading: "Three typed channels; three distinct transition rules.",
    bullets: [
      "pred — pull-time SQL predicate; null means everything",
      "sel — authored row-set push; empty and absent remain different",
      "focus — one observation identity for cross-view inspection",
    ],
    callout: "A lasso, a focused row, and selected graph nodes can coexist.",
    layout: "Three full-width wire lanes with ports, payload examples, and behavior labels. High horizontal rhythm.",
    visual:
      "Purple circle predicate lane, amber square row-set lane, and blue diamond focus lane. Each terminates at a different node behavior.",
    transition: "Clarify: decompose ‘selection’ into the exact dataflow contracts.",
    notes: "Use `pred`, `sel`, and `focus` only as machine discriminants. Use full words in prose.",
    body: `
            <div class="wire-lanes">
                <div class="wire-lane pred-lane"><span class="wire-port circle"></span><div class="wire-stroke"></div><div class="wire-copy"><strong>predicate</strong><code>WHERE cell_type = 'T'</code><small>pull · composable SQL · null = all</small></div></div>
                <div class="wire-lane sel-lane"><span class="wire-port square"></span><div class="wire-stroke"></div><div class="wire-copy"><strong>row set</strong><code>[17, 42, 108, …]</code><small>push · authored evidence · clear ≠ empty</small></div></div>
                <div class="wire-lane focus-lane"><span class="wire-port diamond"></span><div class="wire-stroke"></div><div class="wire-copy"><strong>focus</strong><code>obs_name: A17</code><small>push · one observation · inspect source</small></div></div>
            </div>
            <p class="center-callout">A lasso, a focused row, and selected graph nodes can coexist.</p>`,
  },
  {
    id: "engine",
    chapter: "06 / execution",
    title: "Push dirty. Pull cook. Stop at clean.",
    purpose: "Make the graph execution model legible and connect it to performance at atlas scale.",
    headline: "A lazy graph engine built for interactive evidence.",
    subheading: "Authored actions push invalidation; visible sinks pull only what they need.",
    bullets: [
      "markDirty propagates downstream and aborts superseded epochs",
      "pull walks upstream and halts at a valid cache boundary",
      "authored emissions bypass recooking of the source",
      "only mounted display-active sinks trigger work",
    ],
    callout: "Closed views do not cook. Shared upstream nodes cook once per sweep.",
    layout: "Execution loop occupies the center. Four compact rules align on the right; epoch telemetry sits below.",
    visual:
      "Circular push/pull flow with dirty amber, cooking periwinkle, and clean teal states. A cache node visibly stops traversal.",
    transition: "Mechanism: show how typed wires execute efficiently rather than merely connect visually.",
    notes: "This is a hybrid push-dirty/pull-cook engine. It remains framework-agnostic and value-generic.",
    body: `
            <div class="engine-loop" aria-label="Graph execution loop">
                <svg viewBox="0 0 560 430" role="img">
                    <circle class="engine-orbit" cx="280" cy="212" r="146"/>
                    <path class="engine-arrow push" d="M148 152 A146 146 0 0 1 347 82"/>
                    <path class="engine-arrow pull" d="M414 264 A146 146 0 0 1 214 347"/>
                    <g transform="translate(90 113)"><circle class="state dirty" cx="34" cy="34" r="33"/><text x="34" y="38">PUSH</text><small>dirty</small></g>
                    <g transform="translate(352 87)"><circle class="state cooking" cx="34" cy="34" r="33"/><text x="34" y="38">PULL</text><small>cook</small></g>
                    <g transform="translate(348 284)"><circle class="state clean" cx="34" cy="34" r="33"/><text x="34" y="38">CACHE</text><small>halt</small></g>
                    <g transform="translate(100 287)"><circle class="state emit" cx="34" cy="34" r="33"/><text x="34" y="38">EMIT</text><small>authored</small></g>
                    <text class="epoch" x="280" y="205">epoch 184</text><text class="epoch meta" x="280" y="228">3 sinks · 1 cook</text>
                </svg>
            </div>
            <div class="rule-stack"><div><b>01</b><strong>abort stale epochs</strong></div><div><b>02</b><strong>dedupe diamonds</strong></div><div><b>03</b><strong>compose fan-in at node</strong></div><div><b>04</b><strong>pull mounted sinks only</strong></div><blockquote>Closed views do not cook.</blockquote></div>`,
  },
  {
    id: "system",
    chapter: "07 / system",
    title: "Pixels stay near storage. Questions move.",
    purpose: "Explain the end-to-end browser/server/storage topology and why server-side analytics matter.",
    headline: "One Bun process. One DuckDB connection. One browser workspace.",
    subheading: "Columnar queries cross the wire; multi-million-row datasets do not.",
    bullets: [
      "React + TypeGPU render the interactive workspace",
      "Mosaic queries share one WebSocket connection",
      "DuckDB owns analytical tables, selections, and preaggregations",
      "Custom Zarr I/O opens AnnData, MuData, and OME-Zarr",
      "Bun compiles the host and frontend into one distributable binary",
    ],
    layout: "Layered topology: Browser, Bun host, analytical/storage plane. Arrows label protocol and payload type.",
    visual:
      "Three horizontal system layers with a WebSocket query line, Arrow result line, crop request, and file-backed Zarr/DuckDB sources.",
    transition: "Expand: place the graph engine inside the complete application topology.",
    notes:
      "The product avoids browser memory ceilings. The REST query route remains a test/curl fallback; Mosaic uses WebSocket.",
    body: `
            <div class="system-stack">
                <div class="system-layer browser-layer"><p class="hud">BROWSER / GPU</p><div><strong>React 19</strong><span>Workspace · Canvas · Stage</span></div><div><strong>TypeGPU</strong><span>instanced scatter · lasso</span></div><div><strong>Mosaic</strong><span>cross-filter coordinator</span></div></div>
                <div class="system-bus"><span>WS /mosaic · HTTP API · Arrow IPC · crops</span></div>
                <div class="system-layer server-layer"><p class="hud">BUN HOST</p><div><strong>Bun.serve</strong><span>HTTP · WebSocket · static</span></div><div><strong>DuckDB</strong><span>dataset · preagg · selections</span></div><div><strong>Plugin bootstrap</strong><span>validate · serve · diagnose</span></div></div>
                <div class="system-bus lower"><span>appenders · ranged reads · coordinate transforms</span></div>
                <div class="system-layer storage-layer"><p class="hud">SCIENTIFIC STORAGE</p><div><strong>AnnData</strong><span>obs · var · obsm</span></div><div><strong>MuData</strong><span>modalities</span></div><div><strong>OME-Zarr</strong><span>TCZYX · plates · crops</span></div></div>
            </div>`,
  },
  {
    id: "monorepo",
    chapter: "08 / ownership",
    title: "Package seams follow authority",
    purpose:
      "Show the monorepo target and the dependency direction that enables extensibility without fragmenting the product.",
    headline: "A private workspace with four earned product boundaries.",
    subheading: "The app composes; leaf packages define contracts and scientific I/O.",
    bullets: [
      "@ndea/protocol — serialized HTTP, WebSocket, and plugin wire schemas",
      "@ndea/sdk — plugin and node-author contracts",
      "@ndea/zarr — Bun/Zarrita scientific storage I/O",
      "@ndea/app — the only deployable product composition",
      "docs — isolated Waku deployment outside the product workspace",
    ],
    callout: "Dependency arrows point inward. No package imports the app.",
    layout:
      "Dependency topology centered on @ndea/app, with three leaf packages below and docs separated by a boundary rule.",
    visual: "Architectural package diagram with directional arrows and one highlighted single-binary output.",
    transition: "Partition: convert system layers into maintainable ownership boundaries.",
    notes:
      "This is not a micro-package exercise. Each seam exists because it has a stable independent consumer or contract.",
    body: `
            <div class="package-topology">
                <div class="package app-package"><p class="hud">@NDEA/APP</p><strong>product composition</strong><span>CLI · server · DuckDB · React · GPU</span><em>dist/ndea</em></div>
                <svg viewBox="0 0 900 160" aria-hidden="true"><path d="M450 8 V70 M450 70 H150 V148 M450 70 V148 M450 70 H750 V148"/></svg>
                <div class="package-row"><div class="package"><p class="hud">@NDEA/PROTOCOL</p><strong>wire authority</strong><span>Zod · DTOs · bootstrap</span></div><div class="package"><p class="hud">@NDEA/SDK</p><strong>author authority</strong><span>plugins · nodes · host</span></div><div class="package"><p class="hud">@NDEA/ZARR</p><strong>storage authority</strong><span>AnnData · MuData · OME</span></div></div>
                <div class="docs-boundary"><span>independent deployment boundary</span><strong>docs / Waku</strong></div>
            </div>
            <p class="center-callout">Dependency arrows point inward. No package imports the app.</p>`,
  },
  {
    id: "coupling",
    chapter: "09 / refactor",
    title: "Workspace should compose nodes—not define them",
    purpose:
      "Name the current architectural inversion and the clean target without turning the slide into a code inventory.",
    headline: "Move ownership before changing spelling.",
    subheading: "The refactor deletes parallel authorities instead of renaming them.",
    bullets: [
      "Today: Workspace-prefixed graph types leak into every built-in node",
      "Today: graph specs and lazy descriptors merge as conflicting halves",
      "Today: Dashboard host services are replaced by a Workspace Proxy",
      "Target: SDK → graph/plugin/node core → Workspace → Canvas/Stage",
    ],
    callout: "One definition. One catalog. One host path. One Body lifetime.",
    layout:
      "Before/after dependency paths separated by a vertical cut line. Deletions sit on the cut, not in a third compatibility layer.",
    visual: "Left tangled path with crossed dual authorities; right clean one-way dependency chain.",
    transition: "Contrast: expose why the existing package seams are insufficient for real plugins.",
    notes:
      "The plan removes Ws-prefixed reusable contracts, NodeDef projections, dual registration, host Proxy, and obsolete runtime IDs after migrations.",
    body: `
            <div class="before-after">
                <div class="before"><p class="hud">CURRENT / INVERTED</p><div class="tangle"><span>NodeSpec</span><span>WsNodeSpec</span><span>NodeDef</span><span>NodeDescriptor</span><span>Proxy Host</span></div><strong>parallel authorities hide disagreement</strong></div>
                <div class="cut"><span>DELETE</span><i></i><small>aliases · half merge · proxy · global mutation</small></div>
                <div class="after"><p class="hud">TARGET / DIRECTED</p><div class="dependency-chain"><span>@ndea/sdk</span><i>→</i><span>graph · plugin · node</span><i>→</i><span>Workspace</span><i>→</i><span>Canvas · Stage</span></div><strong>one authority at every layer</strong></div>
            </div>
            <p class="center-callout">One definition. One catalog. One host path. One Body lifetime.</p>`,
  },
  {
    id: "influences",
    chapter: "10 / extensibility",
    title: "Borrow the right behavior from three systems",
    purpose: "Explain the synthesis behind the custom-node and plugin architecture.",
    headline: "OMP runtime discipline + Blender packaging + DCC node assets",
    subheading: "No source is copied wholesale; each solves a different layer.",
    bullets: [
      "OMP: registration-only factory, discovery/loading separation, source-aware failures",
      "Blender: manifest, validation, stable IDs and labels, register/unregister",
      "Houdini + Blender: definitions versus instances, node groups, libraries, exact versions",
    ],
    callout: "Executable plugins add primitives. Declarative node assets let users compose new tools.",
    layout:
      "Three aligned source columns converge into one NDEA model at the bottom. Equal weight; no decorative logo treatment.",
    visual:
      "Three technical pattern streams labeled OMP, Blender, and Houdini/DCC merging into Plugin → Node Definition → Node Asset.",
    transition: "Synthesis: answer the coupling problem with a proven but deliberately narrow extension model.",
    notes:
      "Keep V1 to trusted client custom nodes. Do not prebuild commands, panels, themes, server hooks, or a marketplace.",
    body: `
            <div class="influence-grid">
                <div class="influence"><p class="hud">OMP</p><strong>runtime discipline</strong><ul><li>factory setup</li><li>discovery ≠ loading</li><li>failure isolation</li><li>session-bound runtime</li></ul></div>
                <div class="influence"><p class="hud">BLENDER</p><strong>package discipline</strong><ul><li>manifest first</li><li>validate before run</li><li>ID ≠ label</li><li>register / unregister</li></ul></div>
                <div class="influence"><p class="hud">HOUDINI + DCC</p><strong>authoring discipline</strong><ul><li>definition ≠ instance</li><li>versioned libraries</li><li>linked / embedded</li><li>reusable subgraphs</li></ul></div>
            </div>
            <div class="synthesis-line"><span>PLUGIN PACKAGE</span><i>→</i><span>NODE DEFINITION</span><i>→</i><span>NODE ASSET</span></div>
            <p class="center-callout">Executable plugins add primitives. Declarative assets let users compose new tools.</p>`,
  },
  {
    id: "plugin-contract",
    chapter: "11 / plugin contract",
    title: "Inspect first. Execute second.",
    purpose:
      "Describe the plugin package contract and the strict boundary between wire schema, author API, and app catalog.",
    headline: "One manifest. One factory. One atomic contribution batch.",
    subheading: "Plugin metadata is readable before trusted code executes.",
    bullets: [
      "Protocol owns manifest, bootstrap, and diagnostics schemas",
      "SDK owns PluginFactory, PluginAPI, NodeDefinition, NodeModule, and NodeHost",
      "External node IDs stay inside `${pluginId}/*`",
      "A failed factory commits no partial definitions",
    ],
    callout: "registerNode(definition) is the entire V1 PluginAPI.",
    layout:
      "Manifest code specimen on the left; factory/API flow on the right. One catalog commit line spans the bottom.",
    visual:
      "Compact TOML-like manifest and TypeScript-like factory specimen rendered as instrument readouts, not editor screenshots.",
    transition: "Specification: move from inspiration to the exact public seam.",
    notes:
      "Manifest version, plugin version, SDK range, node type version, config version, asset version, and document version remain distinct.",
    body: `
            <div class="contract-grid">
                <div class="code-panel"><p class="hud">NDEA.PLUGIN.JSON</p><pre><code>{
  "manifestVersion": 1,
  "id": "org.biohub.imaging",
  "version": "1.2.0",
  "sdk": "^0.1.0",
  "client": "./dist/plugin.js",
  "permissions": {
    "gpu": "Render spatial marks"
  }
}</code></pre></div>
                <div class="code-panel"><p class="hud">PLUGIN FACTORY</p><pre><code>export default function setup(api) {
  api.registerNode(cropDefinition)
  api.registerNode(spatialDefinition)

  return () =&gt; disposeSession()
}</code></pre><div class="api-limit"><strong>V1 API</strong><span>registerNode(definition)</span></div></div>
            </div>
            <div class="catalog-commit"><span>validate manifest</span><i>→</i><span>collect batch</span><i>→</i><strong>atomic catalog commit</strong></div>`,
  },
  {
    id: "plugin-lifecycle",
    chapter: "12 / bootstrap",
    title: "The catalog freezes before the Workspace wakes",
    purpose: "Make plugin bootstrap ordering and isolation explicit.",
    headline: "discover → validate → import → collect → freeze → restore → mount → dispose",
    subheading: "Live node instances never observe half-registered state.",
    bullets: [
      "Server scans configured project and user roots once at startup",
      "Approved self-contained ESM and assets receive same-origin URLs",
      "Browser collects each plugin in an isolated registration batch",
      "Workspace loads exact refs only after the catalog freezes",
      "Disposal runs node instances before plugin registrations",
    ],
    callout: "One failed plugin yields diagnostics and unresolved nodes—not an empty Workspace.",
    layout: "Eight-step bootstrap rail across the slide with error isolation branching below validate/import/collect.",
    visual:
      "Sequential lifecycle with a green frozen-catalog gate; a red diagnostic branch returns to the main flow as unresolved preservation.",
    transition: "Sequence: show how the public contract becomes a deterministic session.",
    notes: "Enable, disable, and reload build a new session catalog in V1. Production never mutates a live catalog.",
    body: `
            <div class="lifecycle-rail">
                <div><b>01</b><span>discover</span><small>project · user</small></div><i>→</i>
                <div><b>02</b><span>validate</span><small>schema · path</small></div><i>→</i>
                <div><b>03</b><span>import</span><small>trusted ESM</small></div><i>→</i>
                <div><b>04</b><span>collect</span><small>isolated batch</small></div><i>→</i>
                <div class="freeze"><b>05</b><span>freeze</span><small>NodeCatalog</small></div><i>→</i>
                <div><b>06</b><span>restore</span><small>exact refs</small></div><i>→</i>
                <div><b>07</b><span>mount</span><small>instance runtime</small></div><i>→</i>
                <div><b>08</b><span>dispose</span><small>reverse order</small></div>
            </div>
            <div class="failure-branch"><span class="error-led"></span><strong>plugin failure</strong><i>→</i><span>source diagnostic</span><i>→</i><span>unresolved node</span><i>→</i><b>preserve graph</b></div>`,
  },
  {
    id: "node-contract",
    chapter: "13 / node authoring",
    title: "One definition; one runtime per instance",
    purpose: "Explain the custom-node author model and framework-neutral Body boundary.",
    headline: "Definition is static. Module is lazy. Host is scoped. Body is owned.",
    subheading: "Built-ins and plugins use the same validator and runtime path.",
    bullets: [
      "NodeDefinition: exact identity, ports, config, capabilities, evaluation, hints",
      "NodeModule: lazy runtime and Body factories",
      "NodeHost: capability-gated data, coordination, UI, GPU, and config services",
      "Mounted Body: one HTMLElement plus idempotent disposal",
    ],
    callout:
      "React leaves the SDK. A plugin may own React, Web Components, Canvas, or another framework inside its Body.",
    layout: "Four-part contract anatomy around one node instance, with static/lazy/scoped/owned labels.",
    visual: "Definition flows into module; module creates runtime and Body; host surrounds only the live instance.",
    transition: "Anatomy: zoom from the session lifecycle into one custom node.",
    notes: "The app can keep React adapters for built-ins while the public SDK remains framework-neutral.",
    body: `
            <div class="node-anatomy">
                <div class="anatomy definition"><p class="hud">STATIC</p><strong>NodeDefinition</strong><span>identity · ports · config</span><span>compute · capabilities · hints</span></div>
                <i>load()</i>
                <div class="anatomy module"><p class="hud">LAZY</p><strong>NodeModule</strong><span>createRuntime()</span><span>mountBody()</span></div>
                <div class="instance-boundary"><p class="hud">ONE NODE INSTANCE</p><div class="anatomy host"><p class="hud">SCOPED</p><strong>NodeHost</strong><span>data · focus · GPU · UI</span></div><div class="anatomy runtime"><p class="hud">OWNED</p><strong>runtime + Body</strong><span>compute · element · dispose</span></div></div>
            </div>
            <p class="center-callout">Framework-neutral at the seam. Instrument-native inside the Body.</p>`,
  },
  {
    id: "node-assets",
    chapter: "14 / user authoring",
    title: "Users can turn a working graph into a new tool",
    purpose: "Introduce declarative node assets as the non-code extensibility tier.",
    headline: "Select a subgraph. Promote its interface. Publish a versioned node asset.",
    subheading: "Node assets reuse graph behavior without embedding executable plugin code.",
    bullets: [
      "Promoted input/output ports and parameter bindings define the public interface",
      "Stable local inner IDs compile to outer-instance-scoped runtime IDs",
      "Assets can link from user/project libraries or embed for portability",
      "Nested assets are valid; direct or indirect recursion is rejected",
      "Existing instances remain pinned when a new version is published",
    ],
    callout: "Use asset ≠ edit definition ≠ publish new version.",
    layout:
      "Before-and-after graph transformation: three-node subgraph becomes one named asset with exposed ports. Version/library controls sit below.",
    visual:
      "Purple selection boundary around an inner graph, compression arrow, then one asset node with two promoted inputs and one output.",
    transition: "Empowerment: move from developer-authored primitives to scientist-authored reusable tools.",
    notes:
      "The current Subnet can seed the authoring UI, but its persisted proxy seams must not become the public asset format.",
    body: `
            <div class="asset-transform">
                <div class="subgraph"><p class="hud">SELECTED SUBGRAPH</p><div class="mini-graph"><span>source</span><i class="pred-mini"></i><span>wrangle</span><i class="pred-mini"></i><span>cache</span></div><div class="promote"><b>in</b><b>threshold</b><b>out</b></div></div>
                <div class="compile-arrow"><span>promote interface</span><i>→</i><small>validate · freeze local IDs</small></div>
                <div class="asset-node"><div class="asset-header"><span class="led clean"></span><strong>T-cell gate</strong><em>2.0.0</em></div><div class="asset-body"><span class="port-label pred-label">predicate in</span><code>threshold = 0.72</code><span class="port-label pred-label out">predicate out</span></div></div>
            </div>
            <div class="asset-library"><span>user library</span><i>·</i><span>project library</span><i>·</i><span>linked</span><i>·</i><span>embedded</span><strong>acyclic dependencies only</strong></div>
            <p class="center-callout">Use asset ≠ edit definition ≠ publish new version.</p>`,
  },
  {
    id: "safety",
    chapter: "15 / safety",
    title: "Missing code must never become missing science",
    purpose: "Unify exact versioning, migration, recovery, and trusted-code posture.",
    headline: "Preserve first. Diagnose second. Recover explicitly.",
    subheading: "No plugin failure, future document, or config migration may seed over user work.",
    bullets: [
      "Persist exact node type and asset versions—not ‘latest’",
      "Migrate config before creating runtime or mounting a Body",
      "Render unresolved placeholders for missing or incompatible definitions",
      "Keep raw bytes and versioned backups across document rewrites",
      "Treat V1 plugins as trusted same-origin code; permissions disclose intent, not sandboxing",
    ],
    callout: "Unavailable is a recoverable state—not a reason to delete a node.",
    layout:
      "Central preserved graph record with four failure states around it and one recovery path returning to resolved runtime.",
    visual: "State machine: resolved, unresolved, migrating, recovery. Raw record remains constant at the center.",
    transition: "Guardrail: show how extensibility preserves scientific work instead of increasing fragility.",
    notes:
      "Only a confirmed storage miss may seed a default Workspace. Invalid, future, read-failed, backup-failed, and rewrite-failed states suppress autosave.",
    body: `
            <div class="safety-state">
                <div class="preserved-record"><p class="hud">PRESERVED GRAPH RECORD</p><code>{ nodeTypeId, nodeTypeVersion,<br>config, edges, placement, label }</code><strong>raw bytes + backup</strong></div>
                <div class="failure-state missing"><span></span><strong>missing definition</strong><small>unresolved Body</small></div>
                <div class="failure-state incompatible"><span></span><strong>incompatible SDK</strong><small>source diagnostic</small></div>
                <div class="failure-state migration"><span></span><strong>migration failed</strong><small>quarantine + recover</small></div>
                <div class="failure-state trust"><span></span><strong>trusted plugin</strong><small>permissions disclosed</small></div>
                <svg viewBox="0 0 1000 390" aria-hidden="true"><path d="M500 190 L205 80 M500 190 L795 80 M500 190 L205 318 M500 190 L795 318"/></svg>
            </div>
            <p class="center-callout">Unavailable is a recoverable state—not a reason to delete a node.</p>`,
  },
  {
    id: "roadmap",
    chapter: "16 / execution",
    title: "Refactor in dependency order",
    purpose:
      "Compress the 23-unit plan into a legible implementation sequence and show why sequencing protects user data.",
    headline: "Contract first. Runtime second. Persistence after proof.",
    subheading: "Cleanup and communication close the work only after behavior holds.",
    bullets: [
      "1 — vocabulary, protocol, scientific/storage characterization",
      "2 — SDK, graph extraction, immutable catalog",
      "3 — interaction, node UI, host/runtime, Workspace narrowing",
      "4 — exact persistence, plugin bootstrap, node assets",
      "5 — author example, UI language, HTML presentation, final gates",
    ],
    callout: "No durable migration lands before its canonical runtime exists.",
    layout: "Five horizontal tracks with unit IDs, dependency gates, and one highlighted data-safety checkpoint.",
    visual:
      "Instrument timeline with phase labels and a guarded migration gate between runtime and persistence tracks.",
    transition: "Commitment: turn architectural intent into an ordered, reviewable delivery path.",
    notes: "U8 remains a retired historical ID. Preserve stable unit IDs rather than renumbering the plan.",
    body: `
            <div class="roadmap-tracks">
                <div><b>01</b><strong>name + characterize</strong><span>U1 · U2 · U3 · U13 · U14</span></div>
                <div><b>02</b><strong>contract + extract</strong><span>U4 · U15 · U16</span></div>
                <div><b>03</b><strong>runtime + compose</strong><span>U5 · U17 · U18 · U19 · U6 · U11</span></div>
                <div class="migration-track"><b>04</b><strong>migrate + extend</strong><span>U9 · U20 · U10 · U21</span><em>DATA SAFETY GATE</em></div>
                <div><b>05</b><strong>prove + communicate</strong><span>U22 · U12 · U23 · U7</span></div>
            </div>
            <p class="center-callout">No durable migration lands before its canonical runtime exists.</p>`,
  },
  {
    id: "closing",
    chapter: "17 / promise",
    title: "Context is the product",
    purpose: "Close on the user value that all architectural decisions protect.",
    headline: "From embedding to source image—without losing context.",
    subheading: "A precise instrument for exploring, explaining, and extending imaging atlases.",
    bullets: [
      "One graph document",
      "Typed evidence flow",
      "Exact scientific identity",
      "Extensible primitives and user-authored tools",
      "Recoverable durable work",
    ],
    callout: "nd-embedding-atlas / Node Workspace",
    layout:
      "Large closing statement on the left; a resolved graph-to-image signal line on the right. Minimal final slide.",
    visual:
      "A single periwinkle predicate wire becomes an amber row set, then a blue focus line terminating in a pixel crop frame.",
    transition: "Summary: return to the opening graph with the full meaning of each connection now established.",
    notes:
      "End without a generic call to action. The promise is continuity of scientific context and the ability to extend the instrument deliberately.",
    body: `
            <div class="closing-copy"><p class="hud">NDEA / DESIGN SYSTEM</p><h2>From embedding<br>to source image—<br><span>without losing context.</span></h2><p>A precise instrument for exploring, explaining, and extending imaging atlases.</p></div>
            <div class="closing-signal" aria-label="Predicate to row set to focused source image"><span class="signal-node">predicate</span><i class="pred-segment"></i><span class="signal-node">row set</span><i class="sel-segment"></i><span class="signal-node">focus</span><i class="focus-segment"></i><div class="pixel-frame"><b></b><b></b><b></b><b></b><em>A17 / C2 Z14</em></div></div>`,
  },
];

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function escapeYaml(value: string): string {
  return JSON.stringify(value);
}

function slideBlueprint(slide: Slide, index: number): string {
  const bulletText =
    slide.bullets?.map((bullet) => `- ${bullet}`).join("\n") ??
    "- No bullets; the slide relies on its headline and diagram.";
  const exactCallout = slide.callout ? `\n**Callout:** “${slide.callout}”\n` : "";
  return `## Slide ${index + 1} – ${slide.title}

**Purpose:** ${slide.purpose}

### Content

**Eyebrow:** “${slide.chapter}”

**Headline:** “${slide.headline}”

${slide.subheading ? `**Subheading:** “${slide.subheading}”\n\n` : ""}**Exact bullets:**

${bulletText}
${exactCallout}
### Layout

${slide.layout}

### Typography

- Headline: Geist Mono Variable, 46–64px equivalent, 620 weight, left or center aligned as specified by layout.
- Eyebrow/HUD labels: Geist Pixel, 10–12px, uppercase, 0.14em tracking.
- Body and annotations: Geist Mono Variable, 15–20px equivalent, 420–560 weight.
- Data, IDs, and code: Geist Mono Variable, tabular numerals, compact line height.

### Visual

${slide.visual}

### Stylistic direction

Dark scientific-instrument surface. Use only the committed product palette: near-black periwinkle-tinted background, neutral graphite surfaces, Biohub periwinkle active state, typed-wire purple/amber/sky, teal clean state, and restrained error red. No gradients, generic card grid, glass decoration, marketing imagery, or ornamental motion.

### Transition

${slide.transition}

### Accessibility

Maintain semantic reading order independent of the visual diagram. Diagram has an accessible label or SVG title/description. Body copy meets 4.5:1 contrast. Motion reduces to an instant state under \`prefers-reduced-motion\`.

### Speaker notes

${slide.notes}
`;
}

async function sourceDigest(): Promise<string> {
  const hasher = new Bun.CryptoHasher("sha256");
  for (const path of SOURCE_PATHS) {
    const file = Bun.file(path);
    if (!(await file.exists())) throw new Error(`Presentation source missing: ${relative(ROOT, path)}`);
    hasher.update(relative(ROOT, path));
    hasher.update(new Uint8Array(await file.arrayBuffer()));
  }
  return hasher.digest("hex");
}

async function readFontData(
  label: string,
  candidates: readonly (string | undefined)[],
  existingPattern: RegExp,
): Promise<string> {
  for (const candidate of candidates) {
    if (!candidate) continue;
    const file = Bun.file(candidate);
    if (await file.exists()) return Buffer.from(await file.arrayBuffer()).toString("base64");
  }
  const existing = Bun.file(HTML_PATH);
  if (await existing.exists()) {
    const match = (await existing.text()).match(existingPattern);
    if (match?.[1]) return match[1];
  }
  throw new Error(`${label} font not found. Run dependencies install or set the documented font environment variable.`);
}

function renderBlueprint(digest: string): string {
  const sourceList = SOURCE_PATHS.map((path) => `  - ${escapeYaml(relative(ROOT, path))}`).join("\n");
  return `---
title: "nd-embedding-atlas: The atlas becomes an instrument"
type: presentation-blueprint
date: 2026-07-12
slides: ${slides.length}
audience: "computational biologists, imaging scientists, engineers, and technical stakeholders"
tone: "precise, instrumental, calm"
source_digest: "${digest}"
sources:
${sourceList}
---

# nd-embedding-atlas — Holistic Design Presentation

**Format:** Self-contained 16:9 HTML presentation with offline assets, keyboard/touch navigation, deep links, presenter notes, print/PDF output, visible focus, semantic structure, and reduced-motion behavior.

**Narrative:** Scientific scale → product invariant → investigation workflow → interaction surfaces → typed graph execution → full system and monorepo → architectural inversion → OMP/Blender/Houdini synthesis → plugin contract and lifecycle → user-authored node assets → exact-version recovery and trust → dependency-ordered roadmap → product promise.

**Global visual system:** Geist Mono for every textual/data element; Geist Pixel for HUD signage only. Dark primary surface. Biohub periwinkle marks active state. Predicate, row-set, and focus wires use product purple, amber, and sky respectively. Layouts favor diagrams, rails, and technical topology over card grids.

${slides.map(slideBlueprint).join("\n---\n\n")}`;
}

function renderSlide(slide: Slide, index: number): string {
  const number = String(index + 1).padStart(2, "0");
  return `<section class="slide" id="slide-${number}" data-slide="${index}" data-title="${escapeHtml(slide.title)}" aria-labelledby="slide-${number}-title" hidden>
        <header class="slide-header">
            <p class="chapter hud">${escapeHtml(slide.chapter)}</p>
            <h1 id="slide-${number}-title">${escapeHtml(slide.title)}</h1>
            <p class="slide-number" aria-hidden="true">${number}<span>/</span>${String(slides.length).padStart(2, "0")}</p>
        </header>
        <div class="slide-body">${slide.body}</div>
        <aside class="speaker-notes" aria-label="Speaker notes"><strong>Notes</strong><p>${escapeHtml(slide.notes)}</p></aside>
    </section>`;
}

function renderHtml(digest: string, monoFont: string, pixelFont: string): string {
  const slideTitles = slides.map((slide) => slide.title);
  return `<!doctype html>
<html lang="en" class="dark">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <meta name="color-scheme" content="dark">
    <meta name="theme-color" content="#151419">
    <meta name="description" content="Holistic product and architecture presentation for nd-embedding-atlas.">
    <meta name="ndea-source-digest" content="${digest}">
    <title>nd-embedding-atlas — The atlas becomes an instrument</title>
    <style>
        @font-face { font-family: "Geist Mono Deck"; src: url("data:font/woff2;base64,${monoFont}") format("woff2"); font-style: normal; font-weight: 100 900; font-display: swap; }
        @font-face { font-family: "Geist Pixel Deck"; src: url("data:font/woff2;base64,${pixelFont}") format("woff2"); font-style: normal; font-weight: 400 700; font-display: swap; }
        :root {
            --bg: oklch(0.13 0.004 281); --surface: oklch(0.205 0 0); --surface-2: oklch(0.269 0 0); --surface-3: oklch(0.32 0 0);
            --ink: oklch(0.985 0 0); --ink-2: oklch(0.76 0 0); --ink-3: oklch(0.62 0 0); --border: oklch(1 0 0 / 16%);
            --primary: oklch(0.554 0.236 281); --pred: #8b7bf7; --sel: #f59e0b; --focus: #38bdf8; --clean: oklch(0.69 0.19 170);
            --warning: oklch(0.741 0.181 60); --error: oklch(0.704 0.191 22.216); --radius: 7px;
            --ease: cubic-bezier(.3,.8,.3,1); --pad: clamp(24px, 4vw, 68px); --chrome: 42px;
        }
        * { box-sizing: border-box; }
        html, body { width: 100%; min-height: 100%; margin: 0; background: var(--bg); color: var(--ink); font-family: "Geist Mono Deck", ui-monospace, monospace; }
        body { overflow: hidden; }
        button, dialog { font: inherit; }
        button { color: inherit; }
        button:focus-visible, [tabindex]:focus-visible { outline: 2px solid var(--focus); outline-offset: 3px; }
        .hud { font-family: "Geist Pixel Deck", "Geist Mono Deck", monospace; letter-spacing: .14em; text-transform: uppercase; }
        .deck { position: relative; width: 100vw; height: 100dvh; min-height: 560px; overflow: hidden; isolation: isolate; background: var(--bg); }
        .deck::before { content: ""; position: absolute; inset: 0; z-index: -2; opacity: .24; background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='22' height='22'%3E%3Ccircle cx='1' cy='1' r='1' fill='white' fill-opacity='.12'/%3E%3C/svg%3E"); background-size: 22px 22px; }
        .deck::after { content: ""; position: absolute; inset: 0; z-index: -1; pointer-events: none; border: 1px solid oklch(1 0 0 / 6%); }
        .slide { position: absolute; inset: 0; display: grid; grid-template-rows: auto 1fr; gap: clamp(18px, 2.5vh, 34px); padding: var(--pad) var(--pad) calc(var(--pad) + 28px); opacity: 0; transform: translateX(24px); transition: opacity 220ms var(--ease), transform 220ms var(--ease); overflow: auto; scrollbar-gutter: stable; }
        .slide[hidden] { display: none; }
        .slide.active { opacity: 1; transform: translateX(0); }
        .slide.exiting { display: grid; opacity: 0; transform: translateX(-18px); }
        .slide-header { min-width: 0; min-height: 58px; display: grid; grid-template-columns: minmax(140px, .28fr) minmax(0, 1fr) auto; align-items: start; gap: 26px; border-bottom: 1px solid var(--border); padding-bottom: 15px; }
        .chapter { margin: 4px 0 0; color: var(--ink-3); font-size: 10px; }
        .slide-header h1 { min-width: 0; margin: 0; font-size: clamp(19px, 2.25vw, 34px); font-weight: 580; letter-spacing: -.025em; text-wrap: balance; }
        .slide-number { margin: 0; color: var(--ink-2); font-size: 13px; font-variant-numeric: tabular-nums; }
        .slide-number span { color: var(--primary); margin: 0 5px; }
        .slide-body { min-width: 0; min-height: 0; display: grid; align-content: center; width: min(1480px, 100%); margin: 0 auto; }
        .slide-body h2 { margin: 0; font-size: clamp(34px, 5.2vw, 78px); line-height: 1.02; font-weight: 620; letter-spacing: -.04em; text-wrap: balance; }
        .slide-body h2 span { color: var(--primary); }
        .lede, .section-lede { color: var(--ink-2); font-size: clamp(15px, 1.45vw, 21px); line-height: 1.55; max-width: 62ch; }
        .kicker { color: var(--ink-3); font-size: 10px; }
        .center-callout { margin: clamp(18px, 3vh, 38px) auto 0; padding-top: 15px; border-top: 1px solid var(--border); color: var(--ink-2); font-size: clamp(13px, 1.15vw, 17px); text-align: center; max-width: 72ch; }
        blockquote { margin: 22px 0 0; padding: 14px 18px; border-left: 2px solid var(--primary); background: oklch(0.554 0.236 281 / 8%); color: var(--ink); font-size: clamp(13px, 1.1vw, 17px); line-height: 1.5; }
        code, pre { font-family: "Geist Mono Deck", monospace; }
        .speaker-notes { display: none; position: fixed; left: var(--pad); right: var(--pad); bottom: 58px; z-index: 20; padding: 16px 18px; border: 1px solid var(--border); border-radius: var(--radius); background: oklch(0.13 0.004 281 / 94%); box-shadow: 0 18px 50px #0008; color: var(--ink-2); font-size: 12px; line-height: 1.55; }
        .speaker-notes strong { color: var(--ink); margin-right: 10px; }
        .speaker-notes p { display: inline; margin: 0; }
        body.notes-open .active .speaker-notes { display: block; }
        .deck-chrome { position: fixed; left: 0; right: 0; bottom: 0; z-index: 40; display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; height: var(--chrome); padding: 0 18px; border-top: 1px solid var(--border); background: oklch(0.13 0.004 281 / 90%); backdrop-filter: blur(12px); }
        .deck-title { color: var(--ink-3); font-size: 10px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .nav-controls { display: flex; align-items: center; gap: 6px; }
        .nav-button { min-width: 32px; height: 28px; padding: 0 10px; border: 1px solid var(--border); border-radius: 3px; background: var(--surface); cursor: pointer; font-size: 11px; transition: border-color 120ms, background 120ms; }
        .nav-button:hover { border-color: oklch(1 0 0 / 28%); background: var(--surface-2); }
        .nav-button:disabled { opacity: .38; cursor: default; }
        .chrome-actions { justify-self: end; display: flex; gap: 6px; }
        .progress-track { position: fixed; left: 0; right: 0; bottom: var(--chrome); z-index: 41; height: 2px; background: oklch(1 0 0 / 8%); }
        .progress-bar { display: block; width: 0; height: 100%; background: var(--primary); transition: width 220ms var(--ease); }
        .sr-only { position: absolute !important; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }
        dialog { width: min(560px, calc(100vw - 32px)); border: 1px solid var(--border); border-radius: var(--radius); padding: 0; background: var(--surface); color: var(--ink); box-shadow: 0 30px 100px #000b; }
        dialog::backdrop { background: #000a; }
        .help-head { display: flex; justify-content: space-between; align-items: center; padding: 18px 20px; border-bottom: 1px solid var(--border); }
        .help-head h2 { margin: 0; font-size: 16px; }
        .help-body { padding: 18px 20px 22px; display: grid; grid-template-columns: 1fr 1fr; gap: 11px 20px; color: var(--ink-2); font-size: 12px; }
        .help-body kbd { display: inline-flex; min-width: 28px; justify-content: center; margin-right: 8px; padding: 3px 6px; border: 1px solid var(--border); border-bottom-color: oklch(1 0 0 / 28%); border-radius: 3px; background: var(--bg); color: var(--ink); }

        /* Opening */
        #slide-01 .slide-body { grid-template-columns: .8fr 1.2fr; align-items: center; gap: 20px; }
        .hero-copy { padding-left: 4vw; }
        .hero-copy h2 { font-size: clamp(46px, 7vw, 104px); }
        .hero-copy .signal-line { display: flex; align-items: center; gap: 10px; margin-top: 34px; color: var(--ink-3); font-size: 11px; }
        .signal-line span { width: 34px; height: 2px; background: var(--primary); }
        .hero-graph svg { width: 100%; max-height: 62vh; overflow: visible; }
        .svg-node rect { fill: var(--surface); stroke: var(--border); rx: 7px; }
        .svg-node.selected > rect { stroke: var(--primary); stroke-width: 2; }
        .svg-node text { fill: var(--ink); font: 12px "Geist Mono Deck"; }
        .svg-node text.meta { fill: var(--ink-3); font-size: 10px; }
        .svg-node.chip rect { fill: var(--surface-2); }
        .wire { fill: none; stroke-width: 3; stroke-linecap: round; opacity: .82; }
        .wire.pred { stroke: var(--pred); }.wire.sel { stroke: var(--sel); }.wire.focus { stroke: var(--focus); }.wire.quiet { opacity: .42; }
        .wire.moving { stroke-dasharray: 7 7; animation: wire-flow .8s linear infinite; }
        .led.clean { fill: var(--clean); background: var(--clean); }.led.dirty { fill: var(--warning); background: var(--warning); }
        .port.pred { fill: var(--pred); }.port.sel { fill: var(--sel); }.port.focus { fill: var(--focus); }

        /* Scale */
        #slide-02 .slide-body { grid-template-columns: .66fr 1.34fr; gap: clamp(26px, 5vw, 76px); align-items: center; }
        .metric-stage { display: grid; gap: 28px; align-content: center; border-right: 1px solid var(--border); padding-right: 5vw; }
        .mega { display: grid; }.mega span { font-size: clamp(72px, 11vw, 170px); line-height: .82; color: var(--primary); font-weight: 680; letter-spacing: -.07em; }.mega small { margin-top: 14px; color: var(--ink-2); font-size: 14px; }
        .dimension-stack { display: flex; gap: 8px; }.dimension-stack b { display: grid; place-items: center; width: 42px; height: 42px; border: 1px solid var(--border); color: var(--ink-2); font-weight: 500; }.dimension-stack b:last-child { border-color: var(--focus); color: var(--focus); }
        .identity-chain { display: flex; align-items: center; gap: clamp(7px, 1vw, 16px); margin-top: 30px; }.identity-chain > div { flex: 1; display: grid; justify-items: center; gap: 7px; min-width: 0; }.identity-chain i { color: var(--ink-3); font-style: normal; }.identity-chain small { color: var(--ink-3); font-size: 9px; }.identity-chain strong { font-size: 11px; font-weight: 500; text-align: center; }
        .identity-mark { display: grid; place-items: center; width: 48px; height: 48px; border: 1px solid var(--border); color: var(--ink); font-size: 11px; }.identity-mark.point { border-radius: 50%; }.identity-mark.point::after { content: ""; width: 7px; height: 7px; border-radius: 50%; background: var(--primary); }.identity-mark.row { border-color: var(--sel); }.identity-mark.obs { transform: rotate(45deg); border-color: var(--focus); }.identity-mark.obs::first-letter { transform: rotate(-45deg); }.identity-mark.crop { background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='48' height='48'%3E%3Cpath d='M24 3V45M3 24H45' stroke='white' stroke-opacity='.14'/%3E%3C/svg%3E"); }
        .evidence-list { display: flex; flex-wrap: wrap; gap: 8px 18px; list-style: none; padding: 0; color: var(--ink-3); font-size: 10px; }.evidence-list li::before { content: "·"; color: var(--primary); margin-right: 7px; }

        /* Thesis */
        #slide-03 .slide-body { grid-template-columns: .74fr 1.26fr; align-items: center; gap: 40px; }.thesis-copy p { color: var(--ink-3); font-size: 15px; }.projection-map svg { width: 100%; max-height: 62vh; }.projection-map path { stroke: oklch(1 0 0 / 25%); stroke-width: 1.5; fill: none; }.projection rect { fill: var(--surface); stroke: var(--border); rx: 7px; }.projection.core rect { fill: oklch(0.554 0.236 281 / 13%); stroke: var(--primary); }.projection text { text-anchor: middle; fill: var(--ink); font: 12px "Geist Mono Deck"; }.projection text.meta { fill: var(--ink-3); font-size: 9px; }

        /* Workflow */
        .workflow-rail { display: grid; grid-template-columns: repeat(6, 1fr); gap: 0; position: relative; }.workflow-rail::before { content: ""; position: absolute; left: 7%; right: 7%; top: 29px; height: 1px; background: var(--border); }.workflow-step { position: relative; display: grid; justify-items: center; gap: 10px; text-align: center; }.workflow-step b { z-index: 1; display: grid; place-items: center; width: 58px; height: 58px; border: 1px solid var(--border); border-radius: 50%; background: var(--bg); color: var(--ink-3); font-size: 11px; font-weight: 500; }.workflow-step span { font-size: clamp(15px, 1.5vw, 22px); font-weight: 580; }.workflow-step small { color: var(--ink-3); font-size: 10px; }.workflow-step.pred-step b { border-color: var(--pred); color: var(--pred); }.workflow-step.sel-step b { border-color: var(--sel); color: var(--sel); }.workflow-step.focus-step b { border-color: var(--focus); color: var(--focus); }.workflow-wires { display: grid; gap: 7px; margin: 45px 7% 0; }.workflow-wires span { display: block; height: 2px; opacity: .65; }.pred-line { background: var(--pred); width: 62%; }.sel-line { background: var(--sel); width: 34%; margin-left: 48%; }.focus-line { background: var(--focus); width: 24%; margin-left: 45%; }

        /* Surfaces */
        .surface-system { position: relative; display: grid; grid-template-columns: 1fr .72fr 1fr; align-items: center; gap: 5vw; }.surface { min-height: 280px; border: 1px solid var(--border); padding: 22px; display: grid; grid-template-rows: auto auto auto 1fr; gap: 10px; background: oklch(0.205 0 0 / 60%); }.surface p, .body-core p { color: var(--ink-3); font-size: 9px; margin: 0; }.surface strong, .body-core strong { font-size: 22px; }.surface small, .body-core small { color: var(--ink-3); font-size: 10px; }.surface-slot { align-self: end; height: 86px; border: 1px dashed oklch(1 0 0 / 22%); }.body-core { position: relative; z-index: 2; min-height: 215px; padding: 24px; border: 2px solid var(--primary); background: var(--surface); box-shadow: 0 20px 60px #0008; display: grid; align-content: center; gap: 12px; }.body-core > .led { position: absolute; top: 13px; left: 13px; width: 7px; height: 7px; border-radius: 50%; }.body-signature { margin-top: 15px; padding-top: 12px; border-top: 1px solid var(--border); color: var(--ink-3); font-size: 9px; }.adoption-arrows { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }.adoption-arrows path { fill: none; stroke: var(--primary); stroke-width: 2; stroke-dasharray: 6 8; animation: wire-flow .9s linear infinite; }.forms { display: flex; align-items: center; justify-content: center; gap: 18px; margin-top: 28px; }.forms > div { display: grid; place-items: center; border: 1px solid var(--border); background: var(--surface); color: var(--ink-2); font-size: 10px; }.form-chip { width: 90px; height: 28px; border-radius: 999px !important; }.form-card { width: 120px; height: 64px; }.form-full { width: 160px; height: 92px; }.forms p { color: var(--ink-3); font-size: 10px; }

        /* Wire lanes */
        .wire-lanes { display: grid; gap: 32px; }.wire-lane { display: grid; grid-template-columns: 22px minmax(100px, 1fr) minmax(340px, .8fr); align-items: center; gap: 18px; }.wire-port { display: block; width: 14px; height: 14px; background: currentColor; }.wire-port.circle { border-radius: 50%; }.wire-port.diamond { transform: rotate(45deg); }.wire-stroke { height: 3px; background: currentColor; position: relative; }.wire-stroke::after { content: ""; position: absolute; right: -1px; top: -4px; border-left: 9px solid currentColor; border-top: 5px solid transparent; border-bottom: 5px solid transparent; }.pred-lane { color: var(--pred); }.sel-lane { color: var(--sel); }.focus-lane { color: var(--focus); }.wire-copy { display: grid; grid-template-columns: .8fr 1.2fr; gap: 6px 16px; align-items: baseline; }.wire-copy strong { color: var(--ink); font-size: 20px; }.wire-copy code { color: currentColor; font-size: 12px; }.wire-copy small { grid-column: 1 / -1; color: var(--ink-3); font-size: 10px; }

        /* Engine */
        #slide-07 .slide-body { grid-template-columns: 1.1fr .9fr; align-items: center; gap: 40px; }.engine-loop svg { width: 100%; max-height: 60vh; }.engine-orbit { fill: none; stroke: var(--border); stroke-width: 1.5; }.engine-arrow { fill: none; stroke-width: 3; stroke-linecap: round; }.engine-arrow.push { stroke: var(--warning); }.engine-arrow.pull { stroke: var(--primary); }.state { stroke-width: 2; }.state.dirty { fill: oklch(0.741 0.181 60 / 12%); stroke: var(--warning); }.state.cooking { fill: oklch(0.554 0.236 281 / 12%); stroke: var(--primary); }.state.clean { fill: oklch(0.69 0.19 170 / 12%); stroke: var(--clean); }.state.emit { fill: oklch(0.66 0.15 220 / 12%); stroke: var(--focus); }.engine-loop text { text-anchor: middle; fill: var(--ink); font: 10px "Geist Mono Deck"; }.engine-loop small { color: var(--ink-3); }.engine-loop .epoch { font-size: 18px; font-weight: 600; }.engine-loop .epoch.meta { fill: var(--ink-3); font-size: 10px; }.rule-stack { display: grid; gap: 8px; }.rule-stack > div { display: grid; grid-template-columns: 42px 1fr; align-items: center; min-height: 52px; border-bottom: 1px solid var(--border); }.rule-stack b { color: var(--primary); font-size: 10px; }.rule-stack strong { font-size: 15px; font-weight: 500; }

        /* System */
        .system-stack { display: grid; gap: 0; }.system-layer { display: grid; grid-template-columns: 160px repeat(3, 1fr); gap: 16px; padding: 18px 20px; border: 1px solid var(--border); background: oklch(0.205 0 0 / 58%); }.system-layer > p { color: var(--ink-3); font-size: 9px; }.system-layer > div { display: grid; gap: 5px; }.system-layer strong { font-size: 14px; }.system-layer span { color: var(--ink-3); font-size: 9px; }.browser-layer { border-left: 3px solid var(--primary); }.server-layer { border-left: 3px solid var(--sel); }.storage-layer { border-left: 3px solid var(--focus); }.system-bus { height: 52px; display: grid; place-items: center; color: var(--ink-3); font-size: 9px; position: relative; }.system-bus::before, .system-bus::after { content: ""; position: absolute; left: 50%; width: 1px; height: 15px; background: var(--border); }.system-bus::before { top: 0; }.system-bus::after { bottom: 0; }.system-bus.lower { height: 42px; }

        /* Packages */
        .package-topology { display: grid; justify-items: center; }.package { border: 1px solid var(--border); background: var(--surface); padding: 18px 20px; display: grid; gap: 7px; min-width: 210px; }.package p { margin: 0; color: var(--ink-3); font-size: 9px; }.package strong { font-size: 15px; }.package span { color: var(--ink-3); font-size: 9px; }.app-package { width: min(520px, 70%); border-color: var(--primary); grid-template-columns: 1fr auto; }.app-package p, .app-package strong, .app-package span { grid-column: 1; }.app-package em { grid-column: 2; grid-row: 1 / 4; align-self: center; color: var(--primary); font-style: normal; font-size: 12px; }.package-topology svg { width: min(900px, 85%); height: 105px; }.package-topology svg path { fill: none; stroke: var(--border); stroke-width: 2; }.package-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 24px; width: 100%; }.docs-boundary { margin-top: 28px; width: 100%; padding: 13px 18px; border-top: 1px dashed var(--border); display: flex; justify-content: space-between; color: var(--ink-3); font-size: 10px; }.docs-boundary strong { color: var(--ink-2); font-weight: 500; }

        /* Before / after */
        .before-after { display: grid; grid-template-columns: 1fr 120px 1fr; min-height: 390px; }.before, .after { padding: 28px; border: 1px solid var(--border); display: grid; align-content: center; gap: 24px; }.before p, .after p { color: var(--ink-3); font-size: 9px; }.before > strong, .after > strong { font-size: 14px; font-weight: 500; }.tangle { display: flex; flex-wrap: wrap; gap: 8px; }.tangle span { padding: 10px; border: 1px solid oklch(0.704 0.191 22.216 / 45%); color: var(--ink-2); font-size: 10px; }.dependency-chain { display: grid; justify-items: start; gap: 8px; }.dependency-chain span { padding: 10px 12px; border-left: 2px solid var(--primary); background: oklch(0.554 0.236 281 / 9%); font-size: 11px; }.dependency-chain i { color: var(--primary); font-style: normal; margin-left: 18px; }.cut { display: grid; align-content: center; justify-items: center; gap: 12px; }.cut span { color: var(--error); font-size: 9px; }.cut i { width: 1px; height: 160px; background: var(--error); }.cut small { width: 90px; color: var(--ink-3); font-size: 8px; text-align: center; }

        /* Influences */
        .influence-grid { display: grid; grid-template-columns: repeat(3, 1fr); border: 1px solid var(--border); }.influence { min-height: 310px; padding: 26px; border-right: 1px solid var(--border); }.influence:last-child { border-right: 0; }.influence p { color: var(--ink-3); font-size: 9px; }.influence strong { display: block; margin: 26px 0; font-size: 20px; }.influence ul { list-style: none; padding: 0; display: grid; gap: 13px; color: var(--ink-2); font-size: 11px; }.influence li::before { content: "·"; color: var(--primary); margin-right: 9px; }.synthesis-line { display: flex; justify-content: center; align-items: center; gap: 20px; margin-top: 24px; }.synthesis-line span { padding: 11px 16px; border: 1px solid var(--primary); color: var(--ink); font-size: 10px; }.synthesis-line i { color: var(--primary); font-style: normal; }

        /* Contracts */
        .contract-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }.code-panel { min-height: 320px; border: 1px solid var(--border); background: var(--surface); padding: 20px 24px; }.code-panel p { color: var(--ink-3); font-size: 9px; }.code-panel pre { margin: 22px 0 0; color: var(--ink-2); font-size: clamp(10px, 1vw, 14px); line-height: 1.6; white-space: pre-wrap; }.api-limit { margin-top: 22px; padding-top: 15px; border-top: 1px solid var(--border); display: flex; justify-content: space-between; font-size: 10px; }.api-limit strong { color: var(--primary); }.catalog-commit { display: flex; justify-content: center; gap: 14px; align-items: center; margin-top: 22px; color: var(--ink-3); font-size: 10px; }.catalog-commit strong { padding: 9px 12px; border: 1px solid var(--clean); color: var(--clean); }

        /* Lifecycle */
        .lifecycle-rail { display: flex; align-items: stretch; gap: 8px; }.lifecycle-rail > div { flex: 1; min-width: 0; min-height: 150px; padding: 16px 10px; border: 1px solid var(--border); display: grid; align-content: center; justify-items: center; gap: 10px; text-align: center; }.lifecycle-rail > i { align-self: center; color: var(--ink-3); font-style: normal; }.lifecycle-rail b { color: var(--ink-3); font-size: 9px; }.lifecycle-rail span { font-size: 14px; }.lifecycle-rail small { color: var(--ink-3); font-size: 8px; }.lifecycle-rail .freeze { border-color: var(--clean); background: oklch(0.69 0.19 170 / 8%); }.lifecycle-rail .freeze span { color: var(--clean); }.failure-branch { margin: 32px auto 0; width: min(760px, 90%); display: flex; align-items: center; justify-content: center; gap: 12px; padding: 13px 16px; border: 1px solid oklch(0.704 0.191 22.216 / 45%); color: var(--ink-2); font-size: 10px; }.failure-branch .error-led { width: 7px; height: 7px; border-radius: 50%; background: var(--error); }.failure-branch b { color: var(--clean); }

        /* Node anatomy */
        .node-anatomy { display: grid; grid-template-columns: .8fr 70px .7fr 1.4fr; gap: 16px; align-items: center; }.anatomy { min-height: 210px; padding: 22px; border: 1px solid var(--border); background: var(--surface); display: grid; align-content: center; gap: 12px; }.anatomy p, .instance-boundary > p { color: var(--ink-3); font-size: 9px; margin: 0; }.anatomy strong { font-size: 18px; }.anatomy span { color: var(--ink-3); font-size: 9px; }.node-anatomy > i { color: var(--primary); font-size: 10px; font-style: normal; text-align: center; }.definition { border-left: 3px solid var(--pred); }.module { border-left: 3px solid var(--primary); }.instance-boundary { min-height: 330px; padding: 18px; border: 1px dashed var(--primary); display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: auto 1fr; gap: 14px; }.instance-boundary > p { grid-column: 1 / -1; }.host { min-height: 0; border-left: 3px solid var(--focus); }.runtime { min-height: 0; border-left: 3px solid var(--clean); }

        /* Assets */
        .asset-transform { display: grid; grid-template-columns: 1.1fr .65fr .8fr; gap: 24px; align-items: center; }.subgraph { min-height: 300px; padding: 22px; border: 1px dashed var(--primary); background: oklch(0.554 0.236 281 / 5%); }.subgraph p { color: var(--ink-3); font-size: 9px; }.mini-graph { display: flex; align-items: center; justify-content: center; margin: 70px 0; }.mini-graph span { padding: 13px; border: 1px solid var(--border); background: var(--surface); font-size: 10px; }.mini-graph i { width: 34px; height: 2px; background: var(--pred); }.promote { display: flex; justify-content: space-between; color: var(--pred); font-size: 9px; }.compile-arrow { display: grid; justify-items: center; gap: 12px; color: var(--ink-2); font-size: 10px; }.compile-arrow i { color: var(--primary); font-size: 30px; font-style: normal; }.compile-arrow small { text-align: center; color: var(--ink-3); font-size: 8px; }.asset-node { border: 2px solid var(--primary); background: var(--surface); }.asset-header { display: grid; grid-template-columns: auto 1fr auto; gap: 10px; align-items: center; height: 36px; padding: 0 12px; border-bottom: 1px solid var(--border); }.asset-header .led { width: 7px; height: 7px; border-radius: 50%; }.asset-header strong { font-size: 12px; }.asset-header em { color: var(--ink-3); font-size: 9px; font-style: normal; }.asset-body { min-height: 170px; padding: 24px 14px; display: grid; align-content: space-between; gap: 30px; }.asset-body code { color: var(--ink-2); font-size: 10px; text-align: center; }.port-label { color: var(--pred); font-size: 9px; }.port-label.out { text-align: right; }.asset-library { margin-top: 24px; padding: 13px 16px; border-top: 1px solid var(--border); display: flex; gap: 12px; color: var(--ink-3); font-size: 9px; }.asset-library strong { margin-left: auto; color: var(--error); }

        /* Safety */
        .safety-state { position: relative; min-height: 430px; }.preserved-record { position: absolute; z-index: 2; left: 50%; top: 50%; width: 330px; transform: translate(-50%, -50%); padding: 22px; border: 2px solid var(--primary); background: var(--surface); display: grid; gap: 14px; }.preserved-record p { margin: 0; color: var(--ink-3); font-size: 9px; }.preserved-record code { color: var(--ink-2); font-size: 10px; line-height: 1.6; }.preserved-record strong { color: var(--clean); font-size: 10px; }.failure-state { position: absolute; z-index: 2; width: 200px; padding: 14px; border: 1px solid var(--border); background: var(--bg); display: grid; grid-template-columns: auto 1fr; gap: 4px 10px; }.failure-state span { grid-row: 1 / 3; width: 8px; height: 8px; margin-top: 3px; border-radius: 50%; background: var(--error); }.failure-state strong { font-size: 11px; }.failure-state small { color: var(--ink-3); font-size: 8px; }.failure-state.missing { left: 4%; top: 3%; }.failure-state.incompatible { right: 4%; top: 3%; }.failure-state.migration { left: 4%; bottom: 3%; }.failure-state.trust { right: 4%; bottom: 3%; }.failure-state.trust span { background: var(--warning); }.safety-state svg { position: absolute; inset: 0; width: 100%; height: 100%; }.safety-state svg path { fill: none; stroke: var(--border); stroke-width: 1.5; }

        /* Roadmap */
        .roadmap-tracks { display: grid; gap: 8px; }.roadmap-tracks > div { min-height: 64px; display: grid; grid-template-columns: 48px minmax(210px, .8fr) 1.2fr auto; align-items: center; gap: 18px; padding: 0 18px; border: 1px solid var(--border); border-left: 3px solid var(--surface-3); }.roadmap-tracks b { color: var(--ink-3); font-size: 10px; }.roadmap-tracks strong { font-size: 14px; }.roadmap-tracks span { color: var(--ink-3); font-size: 10px; }.roadmap-tracks em { color: var(--warning); font-size: 8px; font-style: normal; }.roadmap-tracks > div:nth-child(2) { border-left-color: var(--pred); }.roadmap-tracks > div:nth-child(3) { border-left-color: var(--focus); }.roadmap-tracks > div:nth-child(4) { border-left-color: var(--warning); }.roadmap-tracks > div:nth-child(5) { border-left-color: var(--clean); }

        /* Closing */
        #slide-18 .slide-body { grid-template-columns: 1fr 1.2fr; align-items: center; gap: 60px; }.closing-copy h2 { font-size: clamp(38px, 5vw, 74px); }.closing-copy p:last-child { color: var(--ink-2); max-width: 48ch; line-height: 1.6; }.closing-signal { display: grid; grid-template-columns: auto 1fr auto 1fr auto 1fr 150px; align-items: center; }.signal-node { font-size: 9px; color: var(--ink-2); }.closing-signal i { height: 3px; }.pred-segment { background: var(--pred); }.sel-segment { background: var(--sel); }.focus-segment { background: var(--focus); }.pixel-frame { position: relative; width: 150px; height: 150px; border: 1px solid var(--focus); display: grid; grid-template-columns: 1fr 1fr; overflow: hidden; }.pixel-frame b:nth-child(1) { background: #182039; }.pixel-frame b:nth-child(2) { background: #27385d; }.pixel-frame b:nth-child(3) { background: #4a4d78; }.pixel-frame b:nth-child(4) { background: #181824; }.pixel-frame em { position: absolute; left: 8px; bottom: 7px; color: #fff; font-size: 7px; font-style: normal; }

        @keyframes wire-flow { to { stroke-dashoffset: -28; } }
        @media (max-width: 900px) {
            :root { --pad: 22px; }
            .deck { min-height: 480px; }
            .slide-header { grid-template-columns: 90px 1fr auto; gap: 12px; }
            #slide-01 .slide-body, #slide-02 .slide-body, #slide-03 .slide-body, #slide-07 .slide-body, #slide-18 .slide-body { grid-template-columns: 1fr; }
            .hero-graph, .projection-map { max-height: 38vh; }
            .hero-copy { padding-left: 0; }
            .metric-stage { grid-template-columns: 1fr auto; border-right: 0; border-bottom: 1px solid var(--border); padding: 0 0 18px; }
            .mega span { font-size: 70px; }
            .system-layer { grid-template-columns: 100px repeat(3, 1fr); }
            .package-row { gap: 8px; }.package { min-width: 0; padding: 14px; }
            .lifecycle-rail { display: grid; grid-template-columns: repeat(4, 1fr); }.lifecycle-rail > i { display: none; }.lifecycle-rail > div { min-height: 92px; }
            .node-anatomy { grid-template-columns: 1fr 40px 1fr; }.instance-boundary { grid-column: 1 / -1; min-height: 220px; }
            .asset-transform { grid-template-columns: 1fr .4fr 1fr; }
            .closing-signal { grid-template-columns: auto 1fr auto 1fr auto; }.closing-signal .focus-segment, .pixel-frame { display: none; }
        }
        @media (max-width: 640px) {
            body { overflow: auto; }.deck { min-height: 100dvh; height: auto; }.slide { position: relative; min-height: calc(100dvh - var(--chrome)); padding-bottom: 70px; }.slide-header { grid-template-columns: 1fr auto; }.chapter { display: none; }.slide-body { align-content: start; }.deck-title { display: none; }.deck-chrome { grid-template-columns: 1fr auto; }.chrome-actions { display: none; }
            .workflow-rail { grid-template-columns: repeat(2, 1fr); gap: 22px; }.workflow-rail::before, .workflow-wires { display: none; }
            .metric-stage { grid-template-columns: 1fr; }
            .identity-chain { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px; }.identity-chain > i { display: none; }
            .surface-system, .before-after, .influence-grid, .contract-grid, .asset-transform { grid-template-columns: 1fr; }.adoption-arrows, .cut { display: none; }
            .forms { display: grid; grid-template-columns: repeat(3, auto); gap: 8px; }.form-chip { width: 66px; }.form-card { width: 88px; }.form-full { width: 112px; }.forms p { grid-column: 1 / -1; text-align: center; }
            .wire-lane { grid-template-columns: 18px 1fr; }.wire-copy { grid-column: 1 / -1; }
            .system-layer { grid-template-columns: 1fr; }.system-layer > p { margin: 0; }.package-row { grid-template-columns: 1fr; }.package-topology svg { display: none; }
            .lifecycle-rail { grid-template-columns: repeat(2, 1fr); }.failure-branch { flex-wrap: wrap; }
            .node-anatomy { grid-template-columns: 1fr; }.node-anatomy > i { transform: rotate(90deg); }.instance-boundary { grid-column: auto; grid-template-columns: 1fr; }
            .asset-library { flex-wrap: wrap; }.asset-library strong { width: 100%; margin-left: 0; }
            .safety-state { display: grid; gap: 8px; min-height: 0; }.preserved-record, .failure-state { position: static; width: auto; transform: none; }.safety-state svg { display: none; }
            .roadmap-tracks > div { grid-template-columns: 34px 1fr; padding: 12px; }.roadmap-tracks span, .roadmap-tracks em { grid-column: 2; }
            .help-body { grid-template-columns: 1fr; }
        }
        @media (prefers-reduced-motion: reduce) {
            *, *::before, *::after { animation-duration: .001ms !important; animation-iteration-count: 1 !important; scroll-behavior: auto !important; transition-duration: .001ms !important; }
        }
        @media print {
            @page { size: 16in 9in; margin: 0; }
            html, body { background: var(--bg) !important; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
            body { overflow: visible; }
            .deck { width: auto; height: auto; overflow: visible; }
            .deck::before { position: fixed; }
            .slide, .slide[hidden] { position: relative; display: grid !important; width: 16in; height: 9in; break-after: page; opacity: 1 !important; transform: none !important; overflow: hidden; }
            .deck-chrome, .progress-track, dialog, .speaker-notes { display: none !important; }
        }
    </style>
</head>
<body>
    <main class="deck" aria-label="nd-embedding-atlas holistic design presentation">
        ${slides.map(renderSlide).join("\n")}
    </main>
    <div class="progress-track" aria-hidden="true"><span class="progress-bar"></span></div>
    <nav class="deck-chrome" aria-label="Presentation controls">
        <p class="deck-title">nd-embedding-atlas / holistic design</p>
        <div class="nav-controls"><button class="nav-button" id="previous" type="button" aria-label="Previous slide">←</button><button class="nav-button" id="next" type="button" aria-label="Next slide">→</button></div>
        <div class="chrome-actions"><button class="nav-button" id="notes" type="button" aria-pressed="false">notes</button><button class="nav-button" id="fullscreen" type="button">full</button><button class="nav-button" id="help" type="button" aria-label="Keyboard shortcuts">?</button></div>
    </nav>
    <p class="sr-only" id="announcement" aria-live="polite"></p>
    <dialog id="help-dialog" aria-labelledby="help-title">
        <div class="help-head"><h2 id="help-title">Presentation controls</h2><button class="nav-button" id="close-help" type="button" aria-label="Close help">close</button></div>
        <div class="help-body"><span><kbd>→</kbd>next slide</span><span><kbd>←</kbd>previous slide</span><span><kbd>Home</kbd>first slide</span><span><kbd>End</kbd>last slide</span><span><kbd>N</kbd>speaker notes</span><span><kbd>F</kbd>fullscreen</span><span><kbd>?</kbd>this help</span><span><kbd>Esc</kbd>close / exit</span></div>
    </dialog>
    <script>
        (() => {
            const slides = [...document.querySelectorAll(".slide")];
            const titles = ${JSON.stringify(slideTitles)};
            const previous = document.getElementById("previous");
            const next = document.getElementById("next");
            const notes = document.getElementById("notes");
            const fullscreen = document.getElementById("fullscreen");
            const help = document.getElementById("help");
            const helpDialog = document.getElementById("help-dialog");
            const announcement = document.getElementById("announcement");
            const progress = document.querySelector(".progress-bar");
            let index = 0;
            let touchStartX = null;

            const indexFromHash = () => {
                const match = location.hash.match(/^#slide-(\\d{2})$/);
                if (!match) return 0;
                return Math.max(0, Math.min(slides.length - 1, Number(match[1]) - 1));
            };

            const show = (requested, { updateHash = true, announce = true } = {}) => {
                const target = Math.max(0, Math.min(slides.length - 1, requested));
                const current = slides[index];
                const upcoming = slides[target];
                if (current !== upcoming) {
                    current.classList.remove("active");
                    current.hidden = true;
                    current.setAttribute("aria-hidden", "true");
                }
                index = target;
                upcoming.hidden = false;
                upcoming.removeAttribute("aria-hidden");
                requestAnimationFrame(() => upcoming.classList.add("active"));
                previous.disabled = index === 0;
                next.disabled = index === slides.length - 1;
                progress.style.width = ((index + 1) / slides.length * 100) + "%";
                document.title = String(index + 1).padStart(2, "0") + " / " + slides.length + " — " + titles[index];
                if (updateHash) history.replaceState(null, "", "#slide-" + String(index + 1).padStart(2, "0"));
                if (announce) announcement.textContent = "Slide " + (index + 1) + " of " + slides.length + ": " + titles[index];
            };

            const toggleNotes = () => {
                const open = document.body.classList.toggle("notes-open");
                notes.setAttribute("aria-pressed", String(open));
                notes.textContent = open ? "hide notes" : "notes";
            };

            const toggleFullscreen = async () => {
                if (document.fullscreenElement) await document.exitFullscreen();
                else await document.documentElement.requestFullscreen();
            };

            previous.addEventListener("click", () => show(index - 1));
            next.addEventListener("click", () => show(index + 1));
            notes.addEventListener("click", toggleNotes);
            fullscreen.addEventListener("click", toggleFullscreen);
            help.addEventListener("click", () => helpDialog.showModal());
            document.getElementById("close-help").addEventListener("click", () => helpDialog.close());
            helpDialog.addEventListener("click", (event) => { if (event.target === helpDialog) helpDialog.close(); });
            addEventListener("hashchange", () => show(indexFromHash(), { updateHash: false }));
            addEventListener("keydown", (event) => {
                if (helpDialog.open && event.key !== "Escape") return;
                if (["ArrowRight", "ArrowDown", "PageDown", " "].includes(event.key)) { event.preventDefault(); show(index + 1); }
                else if (["ArrowLeft", "ArrowUp", "PageUp", "Backspace"].includes(event.key)) { event.preventDefault(); show(index - 1); }
                else if (event.key === "Home") { event.preventDefault(); show(0); }
                else if (event.key === "End") { event.preventDefault(); show(slides.length - 1); }
                else if (event.key.toLowerCase() === "n") toggleNotes();
                else if (event.key.toLowerCase() === "f") toggleFullscreen().catch(() => {});
                else if (event.key === "?") helpDialog.showModal();
            });
            addEventListener("touchstart", (event) => { touchStartX = event.changedTouches[0]?.clientX ?? null; }, { passive: true });
            addEventListener("touchend", (event) => {
                if (touchStartX === null) return;
                const end = event.changedTouches[0]?.clientX ?? touchStartX;
                const delta = end - touchStartX;
                touchStartX = null;
                if (Math.abs(delta) < 48) return;
                show(index + (delta < 0 ? 1 : -1));
            }, { passive: true });
            show(indexFromHash(), { updateHash: !location.hash, announce: false });
        })();
    </script>
</body>
</html>`;
}

async function writeOrCheck(path: string, expected: string): Promise<void> {
  if (!CHECK) {
    await Bun.write(path, expected);
    return;
  }
  const file = Bun.file(path);
  const actual = (await file.exists()) ? await file.text() : null;
  if (actual !== expected) {
    throw new Error(`Presentation drift: ${relative(ROOT, path)}. Run \`vp run design:presentation\`.`);
  }
}

const digest = await sourceDigest();
const monoFont = await readFontData(
  "Geist Mono",
  [
    process.env.NDEA_GEIST_MONO_FILE,
    resolve(ROOT, "node_modules/@fontsource-variable/geist-mono/files/geist-mono-latin-wght-normal.woff2"),
    resolve(process.cwd(), "node_modules/@fontsource-variable/geist-mono/files/geist-mono-latin-wght-normal.woff2"),
  ],
  /font-family: "Geist Mono Deck"; src: url\("data:font\/woff2;base64,([A-Za-z0-9+/=]+)"\)/,
);
const pixelFont = await readFontData(
  "Geist Pixel",
  [process.env.NDEA_GEIST_PIXEL_FILE, resolve(ROOT, "apps/ndea/src/frontend/fonts/GeistPixel-Square.woff2")],
  /font-family: "Geist Pixel Deck"; src: url\("data:font\/woff2;base64,([A-Za-z0-9+/=]+)"\)/,
);
const blueprint = renderBlueprint(digest);
const html = renderHtml(digest, monoFont, pixelFont);

if (!CHECK) mkdirSync(OUTPUT_DIR, { recursive: true });
await Promise.all([writeOrCheck(BLUEPRINT_PATH, blueprint), writeOrCheck(HTML_PATH, html)]);

console.log(
  `${CHECK ? "Verified" : "Generated"} ${relative(ROOT, BLUEPRINT_PATH)} and ${relative(ROOT, HTML_PATH)} (${slides.length} slides, ${digest.slice(0, 12)}).`,
);
