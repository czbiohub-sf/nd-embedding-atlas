/**
 * SelectionBus (PLUGIN-ARCHITECTURE §6) — the core seam between a plugin's
 * `publishPredicate` and today's predicate stores. It forwards each facet to the
 * existing global setter, preserving exact behavior so nothing observable
 * changes:
 *   - `lasso` / `activeSet` → `ActiveFilterStore` (AND-composed, the LIVE
 *     cross-filter; DashboardProvider is the sole subscriber that drives
 *     `brushSelection.update()` through its rAF bridge).
 *   - `range` / `isolation` → `BrushPredicateStore` (today a dead-end: no
 *     subscriber, drives only the scatter's GPU dim-mask). Routed here so the
 *     produced state is byte-identical; promoting them to a real cross-filter
 *     clause is an INTENTIONAL behavior change deferred to Phase 4 (§6.3), at
 *     which point this branch flips and `BrushPredicateStore` is retired.
 *
 * The per-instance clause-source model (one Mosaic clause source keyed by
 * `instanceId`, §6.3) lands in Phase 4. Here lasso/activeSet still route through
 * the single shared `stableSource`, and range/isolation through a stable
 * per-(instance, facet) source.
 */

import { clearActiveSetFilter, clearLassoFilter, setActiveSetFilter, setLassoFilter } from "@/stores/ActiveFilterStore";
import { setBrushPredicate } from "@/stores/BrushPredicateStore";
import { panelId } from "@/lib/branded-types";
import type { PluginInstanceId, SelectionToken } from "@/core/plugin/host";

/** Canonical predicate facets a view can publish. */
export type SelectionFacet = "lasso" | "activeSet" | "range" | "isolation";

// A temp-table-backed predicate may only enter via `api.publishSelection`, which
// tokens it through `makeToken` (§6.5). `publishPredicate` rejects a raw
// `FROM sel_<id>` / `FROM __scatter_selection` reference that lacks the bus's
// `/* tok=N */` stamp, so a plugin physically cannot publish stable SQL over a
// changing temp table (the Mosaic SQL-text cache gotcha). Scoped to the FROM
// clause so a column literally named `sel_*` in a WHERE predicate is unaffected.
const SELECTION_TABLE_RE = /\bFROM\s+(?:sel_[A-Za-z0-9_]+|__scatter_selection)\b/i;
const TOK_RE = /\/\* tok=\d+ \*\//;

export interface SelectionBus {
  /**
   * Publish (or clear, when `sql` is null) one of an instance's predicate
   * facets. `instanceId` becomes the originating panel id for the lasso facet
   * (Phase 4 promotes it to a real clause source). Throws on a raw temp-table
   * reference lacking a `tok=` SQL-comment stamp (§6.5).
   */
  publishPredicate(instanceId: PluginInstanceId, facet: SelectionFacet, sql: string | null): void;
  /**
   * Stamp a tokened predicate for a namespaced selection table (§6.5). The bus
   * owns the monotonic `tok=N` SQL-comment cache-buster so plugins never invent it.
   */
  makeToken(table: string, count: number): SelectionToken;
  /** Upstream row-set fed in by an edge — null until xyflow edges exist (Phase 5). */
  externalRowSet(): readonly number[] | null;
}

export function createSelectionBus(): SelectionBus {
  // Stable source object per (instance, facet) for the BrushPredicateStore-backed
  // facets, so repeated range/isolation updates from one instance keep a stable
  // Mosaic source identity (the store keys updates by this object).
  const brushSources = new Map<string, object>();
  const brushSourceFor = (instanceId: PluginInstanceId, facet: SelectionFacet): object => {
    const key = `${instanceId}:${facet}`;
    let src = brushSources.get(key);
    if (!src) {
      src = {};
      brushSources.set(key, src);
    }
    return src;
  };

  // Monotonic SQL cache-buster, shared across all instances (per-instance table
  // names already disambiguate WHICH selection; this only needs global SQL-text
  // uniqueness). Replaces the scatter hook's old `largeSelectionVersion`.
  let tokN = 0;

  return {
    publishPredicate(instanceId, facet, sql) {
      if (sql !== null && SELECTION_TABLE_RE.test(sql) && !TOK_RE.test(sql)) {
        throw new Error(
          "publishPredicate: raw temp-table references are forbidden; route through api.publishSelection (§6.5)",
        );
      }
      switch (facet) {
        case "activeSet":
          if (sql === null) clearActiveSetFilter();
          else setActiveSetFilter(sql);
          return;
        case "lasso": {
          const pid = panelId(instanceId as string);
          if (sql === null) clearLassoFilter(pid);
          else setLassoFilter(pid, sql);
          return;
        }
        case "range":
        case "isolation":
          // Behavior-preserving: today these dead-end in BrushPredicateStore
          // (no subscriber, never reaches brushSelection). Keep them there so
          // the produced state is byte-identical; the real effect is the
          // scatter's sibling GPU dim-mask. Promotion to a cross-filter clause
          // is a deferred, explicitly-flagged Phase-4 behavior change.
          setBrushPredicate(brushSourceFor(instanceId, facet), sql);
          return;
        default:
          console.warn(`[selectionBus] unknown facet '${String(facet)}' — ignored`);
      }
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

/** Process-wide selection bus — one composed brushSelection across the app. */
export const selectionBus: SelectionBus = createSelectionBus();
