/**
 * Sole writer for the shared Mosaic crossfilter. Each instance owns one stable
 * clause source; its facets are AND-composed and flushed once per animation
 * frame to avoid writes during Mosaic dispatch.
 */

import { Store } from "@tanstack/store";
import type { Selection } from "@uwdata/mosaic-core";
import { stringPredicate } from "@/lib/mosaic-helpers";
import type { NodeInstanceId, RowSetPublication } from "@ndea/sdk";

export type PredicateFacet = "lasso" | "activeSet" | "chart" | "range" | "isolation";

// Changing temp tables need a unique SQL token or Mosaic returns cached rows.
const SELECTION_TABLE_RE = /\bFROM\s+(?:sel_[A-Za-z0-9_]+|__scatter_selection)\b/i;
const TOK_RE = /\/\* tok=\d+ \*\//;

interface ClauseSource {
  readonly __ndeaInstance: NodeInstanceId;
}

interface InstanceClause {
  readonly source: ClauseSource;
  readonly facets: Map<PredicateFacet, string>;
}

/** Parentheses preserve each predicate's precedence when facets compose. */
function composeFacets(facets: Map<PredicateFacet, string>): string | null {
  const parts = [...facets.values()];
  if (parts.length === 0) return null;
  if (parts.length === 1) return parts[0];
  return parts.map((p) => `(${p})`).join(" AND ");
}

export interface PredicateBus {
  /** Rejects temp-table predicates that lack a cache-busting token. */
  publishPredicate(instanceId: NodeInstanceId, facet: PredicateFacet, sql: string | null): void;
  clearFacet(facet: PredicateFacet): void;
  disposeInstance(instanceId: NodeInstanceId): void;
  attachDestination(selection: Selection): () => void;
  makeToken(table: string, count: number): RowSetPublication;
  externalRowSet(): readonly number[] | null;
  /** Changes even when a row-set bitmap keeps the same identity. */
  readonly revision: Store<number>;
}

export function createPredicateBus(): PredicateBus {
  const registry = new Map<NodeInstanceId, InstanceClause>();
  const dirty = new Set<NodeInstanceId>();
  // Keep the source object: a reused instance id must not cancel an old source's removal.
  const pendingEmpty = new Set<ClauseSource>();
  const revision = new Store(0);

  let destination: Selection | null = null;
  let rafHandle: number | null = null;
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
      fields: [],
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
    for (const source of pendingEmpty) {
      destination.update({ source, clients: new Set(), fields: [], value: [], predicate: null });
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
          "publishPredicate: raw temp-table references are forbidden; route through dataAPI.publishRowSet",
        );
      }
      switch (facet) {
        case "lasso":
        case "activeSet":
        case "chart":
        case "range":
        case "isolation": {
          const clause = ensure(instanceId);
          if (sql === null) clause.facets.delete(facet);
          else clause.facets.set(facet, sql);
          markDirty(instanceId);
          return;
        }
        default: {
          // Defensive: the shim casts an arbitrary string to PredicateFacet, so
          // a runtime-invalid facet can reach here even though it is `never` to TS.
          const unknownFacet: string = facet;
          console.warn(`[predicateBus] unknown facet '${unknownFacet}' — ignored`);
        }
      }
    },

    clearFacet(facet) {
      for (const [id, clause] of registry) {
        if (clause.facets.delete(facet)) markDirty(id);
      }
    },

    disposeInstance(instanceId) {
      const clause = registry.get(instanceId);
      if (!clause) return;
      registry.delete(instanceId);
      dirty.delete(instanceId);
      // Defer the empty clause like every other write to avoid Mosaic reentrancy.
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

/** Process-wide predicate bus — one composed crossfilter across the app. */
export const predicateBus: PredicateBus = createPredicateBus();
