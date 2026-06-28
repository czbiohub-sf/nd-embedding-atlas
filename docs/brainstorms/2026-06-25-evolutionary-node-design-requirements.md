---
date: 2026-06-25
topic: evolutionary-node-design
status: requirements — ready for /ce-plan
scope: Deep (feature)
---

# Evolutionary Node Design

## Problem

Adding or changing a workspace node type touches ~5 scattered sites: the
`WsNodeType` union (`src/frontend/core/workspace/types.ts`), the `NODE_DEFS`
literal (`src/frontend/core/workspace/node-defs.ts`), the cook switch in
`registerEngineNode` (`src/frontend/core/workspace/workspace-store.ts`), the
body switch (`src/frontend/core/workspace/canvas/NdGraphNode.tsx`), and an
import wiring. This was lived adding the `export` node (commit `3655247`).

Two consequences:

- **Slow / drift-prone to change** — five hand-edits, no guard that they stay
  in sync; a missed site fails at runtime, not at build/CI.
- **Unsafe across document evolution** — node configs are types-only
  (`defaultConfig: Config & JsonValue` in `src/frontend/core/plugin/types.ts`),
  restored from persisted docs unvalidated. The `Selection`→`cache` alias is a
  hand-rolled, untested migration. Old saved docs vs new code is the live risk.

There are also **two parallel ways to define a node**: rich plugin descriptors
(`defineDescriptor`, e.g. `src/frontend/plugins/transform-filter/index.ts`) for
the view/transform plugins, and `NODE_DEFS` literals + switches for the
built-in graph nodes (sources, `cache`, `export`, `collection`, `count`,
`subnet`, `proxy`, `wrangle`, …).

## Goal

Make the node layer **evolutionary within its own scope** — cheaper and safer
to change — without speculative futureproofing. The node is the natural
**architectural quantum** (a cohesive unit with a clean edge contract);
evolvability is targeted there, not spread across everything.

Framing: **rigid spine, flexible limbs.** A stable contract that does not bend;
volatile node details that change freely behind it.

Two measurable fitness goals:

- **Faster** — sites-to-change-a-node trends to 1 (node file), with the one
  unavoidable type-level edit guarded so it cannot drift.
- **Safer** — a persisted document never loads into corrupt node state;
  backward-compat breakage fails CI, not a user.

## Non-goals

- Not a rewrite of the engine, Mosaic predicate flow, or rendering.
- Not a config-migration DSL yet — one real migration exists
  (`Selection`→`cache`); the framework waits for a second (last responsible
  moment).
- Not a cook-combinator library yet — built when a _third_ near-duplicate cook
  appears, not before.
- **Not Rust/napi for the node layer** — the node system is browser-side
  (React / xyflow / WebGPU); napi addons load only in a Node/Bun process, and
  the layer is glue (predicate-string composition), not compute. Recorded as
  considered-and-rejected so it is not re-litigated. Native/Rust energy belongs
  in the server-side I/O wall (see roadmap: io-scalability, duckdb-anndata-rust).

## Core decision — one node contract + fitness functions

Every node becomes a self-registering **`NodeSpec`** that co-locates identity,
ports, geometry, a runtime config schema, the cook, and the body. The two
switches collapse to registry lookups. The contract is the rigid spine; the
guards keep it rigid over time.

### The contract (new file, ~30 lines)

```ts
// core/workspace/node-kit.ts
export interface NodeSpec<C = void> {
  type: WsNodeType;
  label: string;
  ports: { in: NdPortKind[]; out: NdPortKind | null }; // out:null = sink
  geometry?: Partial<Geometry>; // defaults filled in
  palette?: boolean;
  config?: z.ZodType<C>; // runtime schema; parsed on doc load
  configVersion?: number;
  cook: (i: CookInputs) => WsValue; // engine behavior
  Body?: ComponentType<{ node: WsNode }>; // canvas body
}

const REGISTRY = new Map<WsNodeType, NodeSpec>();
export const defineNode = <C>(s: NodeSpec<C>) => (REGISTRY.set(s.type, s), s);
export const getNodeSpec = (t: WsNodeType) => REGISTRY.get(t);
export const allNodeSpecs = () => [...REGISTRY.values()];
```

### A node, one file (worked example: `export`)

```ts
// core/workspace/nodes/export.node.tsx
export const exportNode = defineNode({
  type: "export",
  label: "Export",
  ports: { in: ["pred", "sel"], out: null }, // sink
  geometry: { card: { w: 232, h: 132 } },
  palette: true,
  cook: (i) => ({ kind: "pred", sql: andPreds(predSqls(i)) }),
  Body: ExportNodeBody,
});
```

### Switches collapse to lookups

```ts
// registerEngineNode — was a ~100-line switch
const spec = getNodeSpec(type)!;
this.engine.addNode({ id, kind: engineKindOf(spec), cook: spec.cook });

// NdGraphNode body — was a ~50-line switch
const spec = getNodeSpec(node.type);
return spec?.Body ? <spec.Body node={node} /> : <PluginBodyFallback .../>;
```

### Fitness functions (the guards — this is what keeps it evolvable)

```ts
// node-registry.test.ts
test("every node type resolves to a spec", () =>
  ALL_NODE_TYPES.forEach((t) => expect(getNodeSpec(t), t).toBeDefined()));

test("saved-doc configs parse under current schemas", () =>
  SAVED_DOC_FIXTURES.flatMap((d) => d.nodes).forEach((n) => {
    const s = getNodeSpec(n.type);
    if (s?.config) expect(s.config.safeParse(n.config).success).toBe(true);
  }));

test("no new switch(node.type) outside node-kit", () =>
  expect(grepCount("switch (node.type)", "src/frontend")).toBeLessThanOrEqual(0));
```

## Approaches considered

- **A — Unify onto the descriptor (chosen as the spine).** Fold built-in nodes
  into a self-registering spec; switches dispatch through the registry, then die
  node-by-node. Reuses a proven contract; incremental; lowest concept overhead.
  Risk: built-ins are light/structural and don't fit the plugin "lazy heavy
  module" shape — modeled as a lighter `NodeSpec` sibling to `PluginDescriptor`.
- **B — Cook combinators (deferred).** Named, tested primitives
  (`cook.passthrough`, `cook.setConsuming`, `cook.pinnable`, `cook.source`)
  composed per node. Answers the "base functions / inheritance" wish the TS way.
  Deferred until a third near-duplicate cook — avoids primitive-itis.
- **C — Fitness functions first (folded in).** The guards + versioned zod
  schemas. Not a separate approach so much as the safety half of A; landed
  alongside the registry rather than after.

## Recommended sequence (last responsible moment)

1. **`defineNode` registry + the every-type-has-a-spec test.** A's spine and
   C's first guard at once — buys _faster and safer_ in one move; switches
   delegate to the registry so nothing breaks mid-migration.
2. **zod config schema + parse-on-load + `version` field.** Saved-doc safety.
3. **Migrate built-ins onto specs node-by-node**, deleting each switch arm as
   it moves. The "no new switch" ratchet locks the gain.
4. **Defer** cook combinators (3rd duplicate) and a migration DSL (2nd
   migration).

## Scope boundaries

- **In:** the `NodeSpec` contract + registry; migration of the built-in graph
  nodes; zod config schemas with parse-on-load + version field; the three
  fitness-function tests.
- **Deferred:** cook-combinator vocabulary; config-migration registry/DSL;
  folding the existing plugin descriptors into the same `defineNode` call (they
  already work — converge later only if it pays).
- **Out:** engine/predicate-flow changes; rendering changes; Rust/napi for the
  node layer (see Non-goals).

## Success criteria

- Adding a node = the node file + one guarded `WsNodeType` union member; no
  switch edits. CI fails if a type has no spec.
- A persisted document with a stale/invalid node config is caught by
  `safeParse` on load (rejected or repaired), never silently corrupting state.
- A back-compat fixture suite loads prior saved docs green; a breaking schema
  change fails CI.
- `grep "switch (node.type)"` outside `node-kit` stays at zero.

## Open questions

- **`WsNodeType` union vs registry as source of truth.** Keep the union for
  compile-time exhaustiveness in `node.type` discriminations (the chosen
  residual: 2 sites, drift-guarded) — or drop to `string` and lean entirely on
  the runtime registry + tests (1 site, no exhaustiveness)? Leaning keep-union.
- **Engine kind derivation.** `engineKindOf(spec)` — derive the engine node
  kind from ports/role, or keep it an explicit field on `NodeSpec`?
- **Sink modeling.** `out: null` for `export` — confirm the engine and canvas
  handle a registered node with no out port cleanly (today `export` falls
  through the cook `default`).
- **Parse-on-load placement.** Where the `safeParse` runs on document
  hydration (single choke point vs per-node) — a ce-plan detail, flagged here.

## Dependencies / assumptions

- **zod v4** is already a dependency and speaks Standard Schema; no new dep for
  config schemas.
- The existing plugin descriptor system (`src/frontend/core/plugin/`) stays as
  is; `NodeSpec` is a sibling contract, not a replacement, until convergence
  pays.
- Built-in node bodies already live in
  `src/frontend/core/workspace/canvas/node-extras.tsx` and move to spec
  references unchanged.
- Assumption (unverified): a corpus of real persisted documents exists or can
  be captured as fixtures for the back-compat test; if not, seed fixtures from
  current docs at migration time.

## Handoff to /ce-plan

Build order is the recommended sequence above. The first increment (registry +
every-type-has-a-spec test + migrate `export` and one source node as the
template) is the tracer bullet; the rest is repetition under the ratchet.
