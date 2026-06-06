/**
 * SelectionBus (PLUGIN-ARCHITECTURE §6) — the core seam between a plugin's
 * `publishPredicate` and today's `ActiveFilterStore`. Phase 0 forwards each
 * facet to the existing global setters, preserving exact behavior: lasso +
 * active-set compose via AND, DashboardProvider stays the sole subscriber that
 * drives `brushSelection.update()` through its rAF bridge.
 *
 * The per-instance clause-source model (one Mosaic clause source keyed by
 * `instanceId`, §6.3) lands in Phase 4. Here a published facet still routes
 * through the single shared `stableSource`, so nothing observable changes.
 */

import { clearActiveSetFilter, clearLassoFilter, setActiveSetFilter, setLassoFilter } from "@/stores/ActiveFilterStore";
import { panelId } from "@/lib/branded-types";
import type { PluginInstanceId } from "@/core/plugin/host";

/** Canonical predicate facets a view can publish in Phase 0. */
export type SelectionFacet = "lasso" | "activeSet";

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
  return {
    publishPredicate(instanceId, facet, sql) {
      if (facet === "activeSet") {
        if (sql === null) clearActiveSetFilter();
        else setActiveSetFilter(sql);
        return;
      }
      // facet === "lasso"
      const pid = panelId(instanceId as string);
      if (sql === null) clearLassoFilter(pid);
      else setLassoFilter(pid, sql);
    },

    externalRowSet() {
      return null;
    },
  };
}

/** Process-wide selection bus — one composed brushSelection across the app. */
export const selectionBus: SelectionBus = createSelectionBus();
