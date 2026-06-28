# Design brief: node-based workflow system for an embedding/imaging atlas

> A self-contained design brief. Paste into a fresh design conversation — it
> assumes no repo access and frames the real tensions so the discussion is about
> decisions, not context. Living document; update as decisions land.

## What we're building and why

I maintain a browser dashboard that links AI embeddings to their source 5D
microscopy images. Today it's a docked-panel layout (Dockview) where a scatter
plot, a data table, a chart group, and an image viewer all cross-filter each
other. The next architectural era reframes this as a **node graph**: each view or
transform is a node, and the connections between them are *explicit data flows*
rather than implicit global state. Think Houdini or TouchDesigner, but the data on
the wires is SQL predicates (and later, selections and row-sets) that drive a
server-side DuckDB analytical engine.

The motivation is that implicit cross-filtering doesn't scale conceptually. When
five panels all silently filter each other through one shared selection, the user
can't see *why* a view shows what it shows. A graph makes the dataflow legible and
composable: branch a filter, fork an embedding into two differently-colored
scatters, feed one view's selection into another's input on purpose.

## Where it stands right now

A working tracer-bullet on an xyflow canvas. A **graph engine** drives it using
the hybrid model those node tools converge on: a *push* phase marks nodes dirty
and bumps an epoch when a parameter changes, and a *pull* phase cooks nodes on
demand, walking upstream and halting at any clean cached node. Only mounted,
display-active views pull, so closed views never cost compute. Edges carry SQL
predicate strings, fan-in AND-composes, and cycles are rejected — it's DAG-only.

On top of that engine, real plugins now mount as node bodies: a threshold-filter
*transform*, a live count, the real data *table*, the WebGPU *scatter* showing a
live embedding, and the *Idetik* spatial image viewer. Clicking a table row drives
the image viewer's crop. A threshold edit re-cooks the count and table live. The
topology is editable — you can draw and delete edges and the engine reacts.

The plugin contract underneath is a split descriptor: side-effect-free metadata
(id, title, typed input/output ports, capabilities, data requirements) that the
node palette can read without loading any engine code, plus a lazily-loaded module
(the React component, its options, and an optional imperative companion for
transforms). Each plugin declares *capabilities* (`read`, `selection-out`, `gpu`,
`spatial`, …) and *data requirements* (`plate-image`, `obsm` embeddings) that gate
where it can be used.

## The central tension to resolve

Here is the architectural fault line, and the thing most worth thinking through.

The existing app is built on **global cross-view buses**: one shared selection
(crossfilter), one highlight bus, one broadcast bus, one view-sync bus. Every panel
reads and writes these singletons, and the dashboard "just works" because everyone
is plugged into the same wires.

The node graph's entire premise is the opposite: **edges carry data, explicitly and
locally.** A node's input is whatever its incoming edge delivers, not whatever the
global selection happens to be.

So far the two are bridged by reusing the existing per-panel "host" object (which
grants a plugin its data connection, GPU device lease, and bus access) but
overriding just the *input* to come from a per-node selection instead of the global
one. That part is clean — input by edge is correct. But the same host still wires a
plugin's *outputs* (the selection it publishes, the row-sets it broadcasts) straight
to the global buses. On the graph that's currently harmless only by accident:
nothing on the canvas consumes those global writes. It's latent debt. When a node's
*output* needs to flow down an edge to a specific downstream node, exactly those
methods must be intercepted.

A related leak: the scatter plugin still reads the *global* selection for its
internal filtering, so its per-node input is wired but not yet consumed. And
mounting it on the canvas required dragging along an app-level React context
provider it secretly depended on — a sign that "container-agnostic" plugins still
reach into ambient state they shouldn't.

The recurring theme: **the current host treats global buses as the default every
node inherits; the node system wants a host whose I/O is edge-bound by construction,
with global buses as an optional compatibility mode for the old docked surface.**

## Decisions to iterate on

1. **Edge semantics and port type system.** Edges carry SQL predicate strings and
   fan-in is hardcoded to AND. The real system needs richer port types — selections,
   row-sets, maybe column/embedding references and image regions — and fan-in
   operators beyond AND (OR, difference). How rich should the type system be before
   it becomes a burden? What's the minimum vocabulary that still feels composable?

2. **How outputs leave a node.** Should a node's output be a value it *returns* from
   its cook (pure, pull-driven, what the engine already does for predicates), or
   something it *publishes* imperatively (push-driven, what the existing bus-based
   plugins do)? Two mental models colliding. A scatter's lasso is inherently a
   user-driven push; a filter's predicate is a pull. Can one model express both
   cleanly, or are both needed with a clear rule for which is which?

3. **The host's relationship to global state.** Build a new edge-native host and
   make the docked dashboard a *consumer* of the graph (graph = source of truth,
   panels = a layout over it)? Or keep two hosts — one bus-backed for Dockview, one
   edge-backed for the canvas — sharing only the heavy machinery (device leases,
   data access)? The first is more unifying but a bigger rewrite; the second is
   pragmatic but perpetuates two worlds.

4. **Identity, persistence, and what a "node" actually is.** A node has config
   (serializable params) and live state (a GPU device, a scroll position, a
   selection). What survives a save/reload? Is the graph the document, with views as
   projections of it? How do multiple instances of the same plugin coexist as
   distinct nodes?

5. **The canvas as a host environment.** A node is a DOM box on a pan/zoom surface,
   but several views have their *own* internal camera (the GPU scatter, the spatial
   image viewer). Two zoom models stack on one widget. Where does canvas interaction
   end and node interaction begin — and is "a viewport inside a viewport" even the
   right metaphor, or should heavyweight views detach into a fixed inspector while
   the graph stays a lightweight wiring diagram?

6. **Scale and laziness.** Datasets run to millions of observations; compute is
   server-side DuckDB. The engine already gates cooking on display-active views. As
   graphs grow, what's the eviction and caching strategy? When does an edit
   invalidate a server-side materialized table versus reuse it?

## What I want from the design conversation

Help me think these through as a designer, not just an implementer. Push back on the
framing where it's weak. I care most about getting the **edge/output/host model**
(questions 2 and 3) right before it calcifies, because everything else composes on
top of it. Where a decision has a cheap reversible version and an expensive
permanent one, say so. Assume I'll build incrementally and want each step shippable.
