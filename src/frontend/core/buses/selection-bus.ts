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
import type { PluginInstanceId } from "@/core/plugin/host";

/** Canonical predicate facets a view can publish. */
export type SelectionFacet = "lasso" | "activeSet" | "range" | "isolation";

export interface SelectionBus {
  /**
   * Publish (or clear, when `sql` is null) one of an instance's predicate
   * facets. `instanceId` becomes the originating panel id for the lasso facet
   * (Phase 4 promotes it to a real clause source).
   */
  publishPredicate(instanceId: PluginInstanceId, facet: SelectionFacet, sql: string | null): void;
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

  return {
    publishPredicate(instanceId, facet, sql) {
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

    externalRowSet() {
      return null;
    },
  };
}

/** Process-wide selection bus — one composed brushSelection across the app. */
export const selectionBus: SelectionBus = createSelectionBus();
