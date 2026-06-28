/**
 * SelectionBus (PLUGIN-ARCHITECTURE §6.1 / §6.3 / §6.7) — the sole writer of the
 * shared Mosaic crossfilter Selection.
 *
 * Per-instance clause-source model (§6.3): the bus mints exactly ONE branded,
 * stable-for-life Mosaic clause source per `instanceId` (`sourceFor`). Each
 * instance's publishable facets are AND-composed locally into ONE clause that
 * carries `source = sourceFor(instanceId)`, so `Selection.crossfilter` keeps its
 * self-exclusion property (a client is never filtered by a clause whose source
 * it owns) AND distinct instances compose across views. This supersedes the
 * single module-global `stableSource` that used to live in `ActiveFilterStore`.
 *
 * Sole writer + rAF defer (§6.7): `publishPredicate` only records facet state
 * and marks the instance dirty; the actual `destination.update()` is flushed
 * once per frame via `requestAnimationFrame`, outside any active Mosaic dispatch
 * cycle (the `Param.cancel('value')` race the old DashboardProvider bridge
 * documented). DashboardProvider injects the destination Selection once via
 * `attachDestination` and is no longer a writer.
 *
 * Facet routing: ALL facets (`lasso` / `activeSet` / `chart` / `range` /
 * `isolation`) compose into the instance's single clause on the destination
 * crossfilter. `range` (colormap range) and `isolation` (legend category
 * isolation) were promoted here from a dead-end `BrushPredicateStore` write — a
 * deliberate behavior change: they now filter the table and charts, not only the
 * scatter's own GPU dim-mask (which they still drive separately).
 */

import { Store } from "@tanstack/store";
import type { Selection } from "@uwdata/mosaic-core";
import { stringPredicate } from "@/lib/mosaic-helpers";
import type { NodeInstanceId, SelectionToken } from "@/core/node/host";

/** Canonical predicate facets a view can publish. */
export type SelectionFacet = "lasso" | "activeSet" | "chart" | "range" | "isolation";

// A temp-table-backed predicate may only enter via `api.publishSelection`, which
// tokens it through `makeToken` (§6.5). `publishPredicate` rejects a raw
// `FROM sel_<id>` / `FROM __scatter_selection` reference that lacks the bus's
// `tok=N` SQL-comment stamp, so a plugin physically cannot publish stable SQL
// over a changing temp table (the Mosaic SQL-text cache gotcha). Scoped to the
// FROM clause so a column literally named `sel_*` in a WHERE predicate is fine.
const SELECTION_TABLE_RE = /\bFROM\s+(?:sel_[A-Za-z0-9_]+|__scatter_selection)\b/i;
const TOK_RE = /\/\* tok=\d+ \*\//;

/**
 * Stable per-instance clause source — a plain object branded by `instanceId`.
 * Not a Mosaic client (exactly like the old single `stableSource`), so in this
 * step no client self-excludes from it; the per-instance structure exists so a
 * later step can grant true self-exclusion by sourcing an instance's own Mosaic
 * clients against this object.
 */
interface ClauseSource {
  readonly __ndeaInstance: NodeInstanceId;
}

interface InstanceClause {
  readonly source: ClauseSource;
  /** facet → SQL; insertion-ordered. Only the composed (lasso/activeSet/chart) facets land here. */
  readonly facets: Map<SelectionFacet, string>;
}

/**
 * AND-compose an instance's facets in insertion order. A single facet returns
 * its bare predicate (matches the old single-facet `composedPredicate`); two+
 * wrap each in parens so AND binds correctly across complex expressions.
 */
function composeFacets(facets: Map<SelectionFacet, string>): string | null {
  const parts = [...facets.values()];
  if (parts.length === 0) return null;
  if (parts.length === 1) return parts[0];
  return parts.map((p) => `(${p})`).join(" AND ");
}

export interface SelectionBus {
  /**
   * Publish (or clear, when `sql` is null) one of an instance's predicate
   * facets. Composed facets re-compose the instance's single clause and flush
   * it to the destination crossfilter via the rAF defer. Throws on a raw
   * temp-table reference lacking a `tok=` SQL-comment stamp (§6.5).
   */
  publishPredicate(instanceId: NodeInstanceId, facet: SelectionFacet, sql: string | null): void;
  /**
   * Clear `facet` for EVERY registered instance — the collections bridge resets
   * all lassos when a collection becomes the new working scope (the multi-
   * instance equivalent of the old single global lasso slot).
   */
  clearFacet(facet: SelectionFacet): void;
  /**
   * Drop an instance's clause + registry entry on teardown (the per-instance
   * clause leak fix). Publishes an empty clause for its source first so the
   * crossfilter stops filtering by a closed view.
   */
  disposeInstance(instanceId: NodeInstanceId): void;
  /**
   * Inject the destination crossfilter Selection. Returns a detach fn. Called
   * once by DashboardProvider; the bus is the sole writer thereafter (§6.7).
   */
  attachDestination(selection: Selection): () => void;
  /**
   * Stamp a tokened predicate for a namespaced selection table (§6.5). The bus
   * owns the monotonic `tok=N` SQL-comment cache-buster so plugins never invent it.
   */
  makeToken(table: string, count: number): SelectionToken;
  /** Upstream row-set fed in by an edge — null until xyflow edges exist (Phase 5). */
  externalRowSet(): readonly number[] | null;
  /**
   * Monotonic revision — bumped on every composed-facet change and on dispose.
   * A cache-key sentinel for consumers that need to recompute when the selection
   * changes even if a row-set bitmap's identity did not (e.g. the gallery's obs
   * batch fetch). Replaces `ActiveFilterStore.version`.
   */
  readonly revision: Store<number>;
}

export function createSelectionBus(): SelectionBus {
  const registry = new Map<NodeInstanceId, InstanceClause>();
  const dirty = new Set<NodeInstanceId>();
  // Sources of disposed instances awaiting an empty-clause publish. Keyed by the
  // source OBJECT (not instanceId) so a recreated instanceId — which mints a
  // fresh source — never cancels a prior source's pending removal (no leak), and
  // the removal still rides the rAF defer (§6.7) rather than a synchronous
  // update() from a React effect-cleanup path.
  const pendingEmpty = new Set<ClauseSource>();
  const revision = new Store(0);

  let destination: Selection | null = null;
  let rafHandle: number | null = null;
  // Monotonic SQL cache-buster, shared across instances (per-instance table
  // names already disambiguate WHICH selection; this only needs global SQL-text
  // uniqueness). Replaces the scatter hook's old `largeSelectionVersion`.
  let tokN = 0;

  const ensure = (instanceId: NodeInstanceId): InstanceClause => {
    let clause = registry.get(instanceId);
    if (!clause) {
      clause = { source: { __ndeaInstance: instanceId }, facets: new Map() };
      registry.set(instanceId, clause);
    }
    return clause;
  };

  const emit = (clause: InstanceClause): void => {
    if (!destination) return;
    const pred = composeFacets(clause.facets);
    destination.update({
      source: clause.source,
      clients: new Set(),
      value: pred ? [pred] : [],
      predicate: pred ? stringPredicate(pred) : null,
    });
  };

  const flush = (): void => {
    rafHandle = null;
    if (!destination) return; // not yet attached — entries stay queued for attach
    for (const id of dirty) {
      const clause = registry.get(id);
      if (clause) emit(clause);
    }
    dirty.clear();
    // Drain disposed instances: remove each source's contribution from the
    // crossfilter (deferred — same dispatch-safety as every other write).
    for (const source of pendingEmpty) {
      destination.update({ source, clients: new Set(), value: [], predicate: null });
    }
    pendingEmpty.clear();
  };

  const scheduleFlush = (): void => {
    if (rafHandle !== null) return;
    rafHandle = requestAnimationFrame(flush);
  };

  const markDirty = (instanceId: NodeInstanceId): void => {
    dirty.add(instanceId);
    revision.setState((v) => v + 1);
    scheduleFlush();
  };

  return {
    revision,

    publishPredicate(instanceId, facet, sql) {
      if (sql !== null && SELECTION_TABLE_RE.test(sql) && !TOK_RE.test(sql)) {
        throw new Error(
          "publishPredicate: raw temp-table references are forbidden; route through api.publishSelection (§6.5)",
        );
      }
      switch (facet) {
        case "lasso":
        case "activeSet":
        case "chart":
        case "range":
        case "isolation": {
          // Composed facets: record + re-compose the instance's single clause.
          // range/isolation also drive the scatter's GPU dim-mask separately;
          // here they additionally filter the table/charts (the §6.3 promotion).
          const clause = ensure(instanceId);
          if (sql === null) clause.facets.delete(facet);
          else clause.facets.set(facet, sql);
          markDirty(instanceId);
          return;
        }
        default: {
          // Defensive: the shim casts an arbitrary string to SelectionFacet, so
          // a runtime-invalid facet can reach here even though it is `never` to TS.
          const unknownFacet: string = facet;
          console.warn(`[selectionBus] unknown facet '${unknownFacet}' — ignored`);
        }
      }
    },

    clearFacet(facet) {
      // Only the composed facets (lasso/activeSet/chart) ever land in the
      // registry; clearing any other is a harmless no-op.
      for (const [id, clause] of registry) {
        if (clause.facets.delete(facet)) markDirty(id);
      }
    },

    disposeInstance(instanceId) {
      const clause = registry.get(instanceId);
      if (!clause) return;
      registry.delete(instanceId);
      dirty.delete(instanceId);
      // Queue this source's empty clause and flush it through the SAME rAF defer
      // as every other write (§6.7) — never a synchronous update() from the
      // React effect-cleanup path that host.dispose() runs on.
      pendingEmpty.add(clause.source);
      revision.setState((v) => v + 1);
      scheduleFlush();
    },

    attachDestination(selection) {
      destination = selection;
      // Drain anything queued before the destination existed (child mount effects
      // can run before the provider's attach effect; a dispose can land too).
      if (dirty.size > 0 || pendingEmpty.size > 0) scheduleFlush();
      return () => {
        if (destination === selection) destination = null;
      };
    },

    makeToken(table, count) {
      const token = ++tokN;
      return {
        predicate: `__row_index__ IN (SELECT row_index FROM ${table}) /* tok=${token} */`,
        token,
        count,
        table,
      };
    },

    externalRowSet() {
      return null;
    },
  };
}

/** Process-wide selection bus — one composed crossfilter across the app. */
export const selectionBus: SelectionBus = createSelectionBus();
