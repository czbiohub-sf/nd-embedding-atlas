---
date: 2026-06-25
topic: cache-node
---

# Cache node — requirements

## Summary

A source-agnostic **Cache** node that pins its input so everything downstream stays fixed. It is **live by default** — re-lassoing or re-selecting upstream recooks downstream — until you **Cache** it, which freezes the current rows; **Recache** re-pins. It generalizes and replaces today's scatter-bound Selection node, giving any source (filter, table, another selection, scatter lasso) a checkpoint that emits a stable, auditable row-set.

## Problem Frame

Freezing a working set is currently welded to the scatter: you lasso on a scatter node, hit *freeze*, and that mints a Selection node. There is no way to pin anything else — a filter's output, a table's rows, another selection — without routing through a scatter, and making "freeze" synonymous with "scatter lasso" is both restrictive and confusing.

The annotation/proofreading workflow needs a **fixed, auditable input**: a batch of labels should trace back to a stable row-set, not a live selection that shifts under it while the user keeps exploring elsewhere. The checkpoint is the artifact that guarantees "these N obs, frozen at this moment, are what fed this batch."

## Key Decisions

- **Live-by-default, freeze-on-demand.** The node passes its input through live; `Cache` pins the current rows, `Recache` re-pins. Not frozen-on-drop — the workflow is explore-then-lock.
- **A distinct node, not a per-edge pin.** Freezing stays a visible graph artifact, so a cached branch's provenance is inspectable — traded against having to insert and wire the node.
- **Cache supersedes the Selection node.** One freeze concept, not two; the scatter's *freeze* affordance now produces a Cache node wired to its lasso, and the standalone Selection node retires.
- **Single-input checkpoint, not a set-builder.** Combining or hand-curating sets is a separate concern, deliberately excluded.
- **Pins by value.** The cache holds the resolved row-set, so it stays fixed even when upstream re-selects — matching the Selection node's existing freeze semantics. See Outstanding Questions for the "survives underlying data change" nuance.

## Requirements

**Core behavior**
- R1. The node accepts any cooked input — predicate or row-set — on a single input port; the source may be a scatter lasso, a filter, a table selection, or another selection.
- R2. While uncached, the node is live: when the upstream re-emits or re-cooks, downstream recooks.
- R3. `Cache` pins the current rows; downstream then reads the pinned snapshot and is unaffected by further upstream change.
- R4. `Recache` re-pins to the current live input.
- R5. When the live input has moved past the pinned snapshot, the node surfaces a "stale / recache available" state.
- R6. The node's downstream output is a stable predicate representing the pinned row-set.

**Replacing the Selection node**
- R7. The Cache node supersedes the Selection node; the scatter's *freeze* affordance yields a Cache node wired to the lasso rather than a Selection node.
- R8. The Selection node's downstream affordances carry over: spawn wired consumers (table / scatter / gallery), and save the pinned set as a collection.

**Clarity**
- R9. The node communicates its current state unambiguously — live vs cached, and stale-when-cached.

## Acceptance Examples

- AE1. **Covers R2.** Cache is live → user re-lassoes upstream → a downstream table/gallery updates to the new selection.
- AE2. **Covers R3, R5.** Cache is cached → user re-lassoes upstream → downstream stays fixed at the pinned rows, and the node shows "stale / recache available."
- AE3. **Covers R4.** User hits `Recache` → downstream adopts the new pinned rows and the stale state clears.

## Scope Boundaries

- Set algebra (union / intersect / subtract across multiple selections) and manual add/remove curation — out; this is a single-input checkpoint.
- Focus / sync-group behavior is unchanged — the Cache node freezes **data**, not the shared-focus ("in sync") link; the two are orthogonal.
- A named, persistent palette of caches — out; collections already provide durable, named sets.

## Dependencies / Assumptions

- Live propagation already exists in the engine: a node's emission on its port is delivered along edges, marks downstream dirty, and recooks (`src/frontend/core/workspace/workspace-store.ts` `emit` / `markDirty`). "Live by default" reuses this; the Cache node adds only the pin/snapshot layer on top.
- The pinned row-set is materialized as a stable predicate the same way the Selection node already freezes a lasso; Cache reuses that path.

## Outstanding Questions

**Resolve before planning**
- Pin semantics: does the cache pin by **value** (the resolved obs, fixed even if the underlying data changes) or by **predicate @ epoch** (re-evaluable)? Leaning by-value to match the Selection node and the "keep data fixed" intent — confirm.

**Deferred to planning**
- Migration: how existing Selection nodes and the scatter *freeze* button rewire to the Cache node.
- The exact stale-detection signal (epoch comparison vs input-identity change).
- Whether `Recache` is manual-only or also offers an auto-adopt toggle.

## Sources / Research

- Current Selection node (the thing being generalized): `src/frontend/core/workspace/canvas/node-extras.tsx` (`SelectionNodeBody`) — freeze @ epoch, stale/re-freeze, spawn buttons, save-as-collection.
- Live propagation + freeze plumbing: `src/frontend/core/workspace/workspace-store.ts` (`emit`, `markDirty`, `freezeSelection`).
