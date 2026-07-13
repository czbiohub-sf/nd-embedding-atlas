# nd-embedding-atlas vocabulary

This file defines canonical product, architecture, code, protocol, scientific,
and storage language. Contributors must update it when a concept changes.
Current executable contracts outrank stale design sketches.

## Authority and precedence

Use sources in this order when they disagree:

1. Current serialized and public behavior, including persisted data.
2. Current code and executable tests.
3. Accepted requirements and current plans.
4. Historical design and mechanism sketches.

Package ownership decides who names a contract:

| Owner            | Language it owns                                                                                                       |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `@ndea/protocol` | Serialized HTTP, WebSocket, plugin manifest, bootstrap, and diagnostic contracts                                       |
| `@ndea/sdk`      | Plugin and node-author contracts, public port values, modules, hosts, compatibility, and named version axes            |
| `@ndea/zarr`     | AnnData, MuData, OME-Zarr, and Bun-backed scientific storage language                                                  |
| `@ndea/app`      | Graph evaluation, plugin catalog/runtime, node assets, Workspace composition, UI, server sessions, and CLI composition |

Do not duplicate an owned contract in another layer. An adapter may normalize a
boundary into its owner’s internal shape, but it must not invent a parallel
vocabulary.

## Stable identities

These identities do not change in the terminology refactor:

| Concept                           | Canonical identity                          |
| --------------------------------- | ------------------------------------------- |
| Repository                        | `nd-embedding-atlas`                        |
| Executable and CLI                | `ndea`                                      |
| State root and environment prefix | `.ndea` and `NDEA_*`                        |
| Package scope                     | `@ndea/*`                                   |
| Deployable package                | `@ndea/app`                                 |
| Shared packages                   | `@ndea/protocol`, `@ndea/sdk`, `@ndea/zarr` |
| Release assets and published URLs | Existing names and paths                    |

**Workspace** has two deliberate meanings. A Bun workspace is a package-manager
unit under `apps/*` or `packages/*`. Product **Workspace** is one authored graph
document plus its composition, layout, coordination, and persistence. Qualify
the package-manager meaning when both appear in one discussion.

## Product surfaces

- **Workspace** — the product transaction facade. It keeps persisted topology,
  graph evaluation, composition, layout, coordination, and persistence
  synchronized. One dataset session may own one or more Workspace documents.
- **Canvas** — the single graph-editing surface. It owns wiring, hierarchy,
  graph selection, placement controls, and graph geometry.
- **Canvas disposition** — the Canvas geometry within the Workspace. Current
  values are strip and full. A disposition changes geometry and camera; it does
  not create a second Canvas or a product mode.
- **Stage** — the tiled composition surface for focused node Bodies.
- **Tile** — a Stage projection of one node Body. It is not an independent node
  instance.
- **Body** — one mounted UI element owned by a node runtime. Canvas, Stage, and
  fullscreen sockets adopt the same Body; they never remount it.
- **Placement** — where a Body materializes: embedded on Canvas or staged.
- **Chip**, **card**, **full Body** — zoom-semantic presentations of one node.

Use **Dashboard**, **panel**, **dock**, and **viewer** only when naming a genuine
third-party API, compatibility boundary, or qualified UI component. They are not
synonyms for Workspace, Stage, tile, or Body.

## Graph and node model

- **Graph document** — persisted nodes, exact definition refs, edges, config,
  layout, placement, and interaction state. It is the source of truth; product
  surfaces are projections.
- **Graph engine** — evaluates the graph. Authored actions push invalidation or
  emissions; visible sinks pull required upstream values and stop at clean
  cache boundaries.
- **Node** — the graph and authoring noun.
- **Node definition** — one versioned author contract for one exact node type.
  `NodeDefinition` owns identity, ports, config schema and migrations,
  capabilities, requirements, evaluation, lazy module, and portable
  presentation hints.
- **Node module** — the lazy executable implementation of a node definition.
- **Node host** — capability-gated services scoped to one live node instance.
- **Node runtime** — the per-instance compute and lifecycle object.
- **Node instance** — one exact-version occurrence in a Workspace graph.
- **Node catalog** — an immutable session snapshot of validated native, plugin,
  and node-asset definitions.
- **Unresolved node** — a preserved instance whose exact definition is missing,
  disabled, incompatible, or failed. Unresolved state never deletes graph data.
- **Custom node** — the user-facing umbrella for a plugin-provided definition or
  a declarative node asset.

One exact `{ nodeTypeId, nodeTypeVersion }` resolves to one `NodeDefinition`.
The app may add provenance and product policy while constructing its catalog;
it must not copy or override author-owned definition fields.

### Ports and dataflow

Machine discriminants remain `pred`, `sel`, and `focus`:

- **Predicate** (`pred`) — a pull-time condition defining row membership. A
  null predicate means all rows.
- **Row-set selection** (`sel`) — an authored explicit set of row identities.
  Empty and absent remain different states.
- **Focused observation** (`focus`) — one observation identity used for linked
  inspection.

A predicate is a rule; evaluating it against one dataset snapshot produces a
row set. A row set may be represented as an `IN (...)` predicate, but that
conversion freezes its current membership.

- **Wire** — a typed connection between ports.
- **Fan-in** — composition at one input, such as `AND`, `OR`, or difference.
- **Cache node** — the canonical checkpoint that materializes a clean graph
  boundary. The retired Selection node exists only in a versioned persistence
  migration.
- **Wrangle node** — the general transform node. Threshold behavior migrates to
  Wrangle only after equivalence is proven; otherwise it remains an ordinary
  compatibility definition.
- **Image Viewer** — palette and header label for canonical node type
  `image-viewer`. Legacy persisted `fov` node IDs migrate explicitly.

## Interaction and identity

Do not use generic `selection` when the exact domain is known:

- **Predicate** — a query condition.
- **Row set** — explicit row membership.
- **Focus** — one observation identity shared across views.
- **Highlight** — visual emphasis only; it does not change focus or membership.
- **Collection** — a durable named user-authored row group. Preserve the capital
  letter when referring to the product entity.
- **Graph selection** — selected editor nodes or edges.

Keep these identifier domains distinct:

| Identity                      | Meaning                                                            | Durability               |
| ----------------------------- | ------------------------------------------------------------------ | ------------------------ |
| Row index                     | Position in the current tabular snapshot                           | Snapshot-local           |
| Observation name / `obs_name` | Scientific observation identity                                    | Dataset-defined          |
| GPU point index               | Position in one uploaded render buffer                             | Render-local             |
| Collection membership         | Durable authored grouping                                          | Storage-backed           |
| Dataset key                   | Stable logical dataset identifier in app/protocol state            | App-defined              |
| Dataset location              | Filesystem or URL location used to open a dataset                  | Environment-defined      |
| Plate location                | Well/field/image position within plate metadata                    | Scientific-store-defined |
| Mount                         | Runtime association between a logical dataset and an opened source | Session-local            |
| Node instance ID              | One node occurrence in a Workspace document                        | Document-defined         |
| Node type ID                  | Stable lowercase kebab-case definition identity                    | Definition-defined       |

Extend branded types where plain strings or numbers erase these distinctions.
Do not redesign durable scientific identity during a naming cutover.

## Plugins and node assets

- **Plugin** — a trusted installable code package with one versioned manifest
  and one self-contained client factory.
- **Plugin factory** — a default-exported registration-only setup function. It
  may return one session disposer.
- **Plugin API** — the setup-time registration surface. V1 exposes custom-node
  registration only.
- **Node asset** — a versioned declarative reusable subgraph created by a user.
  It stores promoted ports and parameters, exact dependencies, presentation,
  hidden/internal state, and linked or embedded provenance.

Plugins install executable primitives. Node assets package authored graphs.
Executable plugin code never embeds in a Workspace document. Node assets may
nest but never recurse. Existing instances resolve exact versions and never
silently follow “latest.”

V1 plugins are trusted same-origin JavaScript. They may own React, Web
Components, Canvas, or another framework inside their Body, but the SDK Body
contract is framework-neutral. V1 excludes mutable Workspace access, generic
events, commands, panels, themes, server routes, SQL/storage hooks, filesystem
objects, a remote marketplace, and a sandbox.

## Capabilities, permissions, and availability

- **Plugin permission** — manifest disclosure of high-risk intent and its
  reason. It does not sandbox malicious code.
- **Node capability** — a host service a definition may request, such as GPU or
  focus coordination.
- **Data capability** — a fact about currently mounted data, such as available
  observations, embeddings, spatial data, or channels.
- **Node availability** — whether one definition can run with the current host,
  platform, data capabilities, permissions, and dependencies.

Keep these types separate. Availability may depend on capabilities and granted
permissions; none is an alias for another.

## Version axes

Never collapse these into an unqualified `version` across a module boundary:

| Axis                       | What it versions                     | Migration rule                                  |
| -------------------------- | ------------------------------------ | ----------------------------------------------- |
| Manifest schema version    | Plugin manifest shape                | Protocol parser migration                       |
| Plugin package version     | Installable code package             | Package installation policy                     |
| SDK version/range          | Public author contract compatibility | Manifest compatibility check                    |
| Node type version          | One exact definition contract        | Persist and resolve exactly                     |
| Node config version        | Config owned by one definition       | Stepwise migration before runtime/Body creation |
| Node asset version         | Published declarative graph contract | Explicit publish and upgrade                    |
| Workspace document version | Persisted graph document shape       | One-way document migration with backup          |
| Binary format version      | Existing binary header/layout        | Never rename fields inside one version          |

## Scientific and storage language

Preserve upstream and standards-owned terms exactly:

- AnnData, MuData, OME-Zarr, OME-NGFF, HCS, FOV, TCZYX
- `obs`, `var`, `obsm`, `obs_name`, `dtype`, CSR, CSC
- Zarr metadata keys such as `encoding-type` and `column-order`
- DuckDB, SQL table/view names, cache keys, sidecars, Collection storage, and
  annotation storage

**FOV** is a scientific field of view or acquisition unit. It is not the Image
Viewer node identity. **Idetik** names the renderer/display integration; it is
not the scientific observation or node type.

Internal surrounding names may become clearer, but adapters must not copy large
scientific arrays merely to normalize casing. Any physical storage migration
requires a dedicated durability plan.

## TypeScript and file naming

- Types, classes, interfaces, and components: `PascalCase`.
- Functions, methods, fields, and local values: `camelCase`.
- Constants: `SCREAMING_SNAKE_CASE`.
- Hooks: `useX`.
- Stable IDs: lowercase kebab-case unless an external standard owns the value.
- Files: kebab-case by default; PascalCase for components; `useX` for hooks.
- Acronyms and brands retain accepted forms: NDEA, SDK, API, CLI, GPU, SQL,
  HTTP, WebSocket, DuckDB, WebGPU, TypeGPU, AnnData, MuData, OME-Zarr, Idetik.

Qualify generic exported names such as `State`, `Config`, `Store`, `Context`,
`Meta`, `Panel`, and `Viewer` with their owner or role. Internal TypeScript
renames cut over atomically: migrate every caller, then delete old aliases,
wrappers, and re-exports.

## Boundary posture

| Boundary                  | Canonical shape                                             | Posture                                               |
| ------------------------- | ----------------------------------------------------------- | ----------------------------------------------------- |
| Internal TypeScript       | Owner-qualified names and direct package barrels            | Clean atomic cutover                                  |
| Public package exports    | Canonical `@ndea/*` entrypoints                             | Clean cutover while packages remain private           |
| HTTP, WebSocket, YAML     | Protocol-owned serialized keys with intentional casing      | Preserve by default; normalize at parser seams        |
| Persisted Workspace       | Versioned document and node/config keys                     | One-way migration with backup and recovery            |
| SQL, cache, sidecar       | Existing query and storage schema                           | Preserve; require a durability prerequisite to change |
| Binary formats            | Existing versioned header and layout                        | Freeze within each version                            |
| Scientific/on-disk        | Upstream AnnData, MuData, OME-Zarr, and NGFF terms          | Freeze                                                |
| Plugin manifest/bootstrap | Protocol-owned schema with exact IDs, versions, and paths   | Validate before import                                |
| Node identity             | Exact `{ nodeTypeId, nodeTypeVersion }`                     | Persist exactly; never resolve latest silently        |
| Node assets               | Versioned declarative graph with linked/embedded provenance | Explicit publish and upgrade                          |
| Prose and UI              | Full canonical nouns and standard uppercase acronyms        | Update after executable contracts pass                |

## Cutover index

U2 owns the executable baseline and compatibility detail for each row. Later
units close their rows only after tests pass.

| Current or ambiguous shape                                        | Canonical concept                                                    | Owner                        | Audiences                     | Boundary posture                       | Unit         |
| ----------------------------------------------------------------- | -------------------------------------------------------------------- | ---------------------------- | ----------------------------- | -------------------------------------- | ------------ |
| `.design/VOCABULARY.md`                                           | Root vocabulary authority                                            | Repository                   | Contributors                  | Documentation cutover                  | U1           |
| App-local shared DTOs and `NdeaProtocol` guesses                  | Protocol-owned schemas                                               | `@ndea/protocol`             | API consumers, app            | Preserve serialized output             | U2, U3       |
| Zarr wrapper names mixed with upstream fields                     | Qualified internal wrapper names; unchanged scientific fields        | `@ndea/zarr`                 | SDK/data authors              | Freeze on-disk language                | U13          |
| `NodeSpec`, `NodeMeta`, `NodeDescriptor`, `NodeDef`, `WsNodeSpec` | One `NodeDefinition` plus app catalog provenance                     | SDK/app node core            | Plugin and node authors       | Atomic TypeScript cutover              | U4, U14, U16 |
| Reusable `Ws*` graph/value contracts                              | Unprefixed graph and SDK contracts                                   | App graph core / SDK         | App and plugin authors        | Atomic TypeScript cutover              | U4, U15      |
| Generic live `selection` fields                                   | Predicate, row set, focus, highlight, Collection, or graph selection | App coordination             | Users and app authors         | Preserve behavior and persisted values | U5           |
| Generic server `ViewerState`, `Store`, and route-local shapes     | Owner-qualified server session and storage wrappers                  | App server                   | Operators and app authors     | Preserve routes/storage                | U6           |
| Retired Selection node                                            | Cache node                                                           | App node catalog             | Users and persisted documents | Versioned document migration           | U9, U10      |
| `fov` node identity                                               | `image-viewer` ID; Image Viewer label                                | App node catalog             | Users and persisted documents | Versioned document migration           | U9, U10      |
| Generic project/runtime config names                              | Owner-qualified internal config; accepted YAML/CLI spellings         | App CLI                      | Operators                     | Normalize at parser seam               | U11          |
| Mutable or parallel registries                                    | Immutable `NodeCatalog`                                              | App plugin/node core         | App and plugin authors        | Atomic TypeScript cutover              | U16          |
| Node UI importing Workspace internals                             | `NodeModule` using scoped `NodeHost`                                 | SDK/app node core            | Node authors                  | Atomic implementation cutover          | U17          |
| Dashboard host shim and Workspace Proxy                           | One app host factory and per-instance lifetime                       | App node core                | App/node authors              | Behavioral cutover after proof         | U18          |
| Reusable contracts owned by Workspace                             | Graph/plugin/node cores behind one transaction facade                | App composition              | App authors                   | Atomic ownership cutover               | U19          |
| Implicit built-in boot and external imports                       | Native plugin plus validated plugin bootstrap                        | Protocol/SDK/app plugin core | Plugin authors/operators      | Validate before execution              | U20          |
| Subnet proxy as reusable format                                   | Versioned declarative node asset                                     | App node-asset core          | Users and node authors        | Explicit publish/upgrade               | U21          |
| Generic Dashboard/panel/viewer app names                          | Workspace/Stage/tile/qualified renderer names                        | App frontend                 | Users and app authors         | Atomic TypeScript/UI cutover           | U12          |
| Historical design deck or mechanism sketch as authority           | Generated presentation derived from reviewed sources                 | Repository                   | Stakeholders                  | Drift-checked generated artifact       | U23          |
| Retired aliases, reverse imports, manual lists                    | Canonical barrels and enforced package direction                     | Repository                   | Contributors                  | Delete after all cutovers              | U7           |

## Contract-impact ledger

Compatibility classes:

- **type-only** — runtime and serialized data remain byte-for-byte equivalent.
- **additive** — an existing parser or surface accepts a new valid shape without
  invalidating old input.
- **boundary-normalized** — old and canonical external spellings normalize into
  one internal shape; conflicts fail explicitly.
- **breaking** — durable data changes only through a named version and
  migration.

| Current shape                                                                              | Canonical shape                                                                | Owner and consumers                                 | Class               | Migration posture                                                                            | Executable baseline                                                                                | Unit        |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ | --------------------------------------------------- | ------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ----------- |
| Embedding status schema omitted runtime `not_started` and stripped `n_dims`                | Shared schema preserves `not_started`, loading, ready with `n_dims`, and error | Protocol; server, WebSocket, scatter loader         | additive            | Keep HTTP and WebSocket output unchanged; broaden parser only                                | `packages/protocol/src/index.test.ts`; `apps/ndea/src/server/__tests__/app.test.ts`                | U2          |
| `NdeaProtocol[\"collections/create\"]` claimed a bare Collection                           | `CollectionMutationResult` envelope already returned by HTTP                   | Protocol; collection routes and frontend hooks      | type-only           | Correct the type map; preserve raw response keys and values                                  | `packages/protocol/src/index.test.ts`; `apps/ndea/src/server/__tests__/collections-routes.test.ts` | U2, U3      |
| `NdeaProtocol[\"var-column/load\"]` required `layer` and omitted `modality`                | Shared `VarColumnBody` with optional `layer` and `modality`                    | Protocol; var route, WebSocket bridge, scatter hook | type-only           | Correct the type map; preserve accepted request spellings and default `layer = \"X\"`        | `packages/protocol/src/index.test.ts`; `apps/ndea/src/server/routes/var.ts`                        | U2, U3      |
| App-local request/response interfaces duplicate shared routes                              | One schema and inferred type in `@ndea/protocol`                               | Protocol; server and frontend consumers             | type-only           | Migrate every consumer atomically; do not change serialized casing                           | Protocol tests plus affected route integration tests                                               | U3          |
| Internal Zarr wrapper names sit beside `obs`, `var`, `obsm`, metadata, and encoding fields | Qualified wrappers around exact upstream scientific language                   | Zarr; app ingest and scientific-data authors        | type-only           | Freeze scientific keys, axes, metadata, and written bytes                                    | Package Zarr parser, round-trip, and publication tests                                             | U13         |
| Generic server session/storage wrapper names                                               | Owner-qualified internal names                                                 | App server; CLI startup and route handlers          | type-only           | Rename callers atomically; preserve routes, SQL, caches, and sidecars                        | Server route, startup, store, and state tests                                                      | U6          |
| Internal project/runtime config names overlap with accepted CLI/YAML spellings             | One qualified internal config after parser normalization                       | App CLI; operators and startup                      | boundary-normalized | Continue accepting documented aliases; equal aliases pass and conflicts fail                 | CLI router/config fixtures and generated command metadata                                          | U11         |
| Persisted graph records carry legacy node identity and duplicated definition metadata      | Exact node definition ref plus instance-owned config/layout/state              | App persistence; users and node catalog             | breaking            | Increment `DOC_VERSION`, back up raw data, migrate once, validate, then save canonical shape | Workspace persistence and round-trip fixtures                                                      | U9, U10     |
| Persisted Selection node                                                                   | Cache node                                                                     | App graph/persistence; users                        | breaking            | Versioned identity/config migration after equivalence tests                                  | Cache, legacy-document, and migration fixtures                                                     | U9, U10     |
| Persisted `fov` node ID                                                                    | `image-viewer` exact type ID; Image Viewer label                               | App node catalog/persistence; users                 | breaking            | Versioned identity/config migration; preserve scientific FOV fields                          | Image Viewer and legacy-document fixtures                                                          | U9, U10     |
| No plugin manifest/bootstrap wire contract                                                 | Versioned manifest, bootstrap catalog, and diagnostics                         | Protocol; CLI, server, browser, plugin authors      | additive            | Validate before import; invalid packages execute no code                                     | Manifest parser, static serving, bootstrap, and compiled-host tests                                | U20         |
| Subnet proxy/storage representation is the only reusable-subgraph seam                     | Versioned declarative node asset with exact dependencies and provenance        | App node-asset core; users and node authors         | additive            | New schema; explicit publish and upgrade; never reinterpret Subnet data silently             | Node-asset schema, compile, nesting, cycle, and restore tests                                      | U21         |
| SQL views, DuckDB tables, Collection/annotation storage, ingest caches, and sidecars       | Existing physical identities and lifecycle                                     | App server/storage; users and operators             | type-only           | Preserve; pause for a dedicated durability prerequisite before any physical change           | Store, Collection, annotation, ingest-cache, and sidecar suites                                    | U2, U6, U10 |
| Existing binary headers and AnnData/MuData/OME-Zarr metadata                               | Existing versioned layouts and standards-owned names                           | Protocol/Zarr; data authors and external tools      | type-only           | Freeze within each version; no cosmetic casing migration                                     | Binary header and Zarr convention/round-trip suites                                                | U2, U13     |
