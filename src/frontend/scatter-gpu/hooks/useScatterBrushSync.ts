import { useDebouncer, useThrottler } from "@tanstack/react-pacer";
import type { RefObject } from "react";
import { useRef } from "react";
import { useOptionalHost } from "../../core/host/host-context";
import { clearLassoFilter, setLassoFilter } from "../../stores/ActiveFilterStore";
import { broadcastSelection, clearSelectionSync, panelSource } from "../../stores/SelectionSyncStore";
import type { PanelId } from "../types";

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * LEGACY large-selection path — the host-less floating scatter ONLY. The
 * docked/plugin path now stages rows via `host.api.publishSelection` → a
 * per-instance `sel_<instanceId>` table with the bus-owned `tok=N` SQL-comment
 * cache-buster (§6.5). This fixed `__scatter_selection` path remains because the
 * floating scatter has no host.
 *
 * Mosaic's QueryManager caches by raw SQL text, so the changing temp table needs
 * a unique suffix per revision; the `AND 'vN'='vN'` is a no-op at execution time.
 */
let largeSelectionVersion = 0;

function largeSelectionPredicateLegacy(): string {
  largeSelectionVersion++;
  return `__row_index__ IN (SELECT row_index FROM __scatter_selection) AND 'v${largeSelectionVersion}' = 'v${largeSelectionVersion}'`;
}

async function syncLargeSelectionLegacy(rowIds: number[]): Promise<string | null> {
  if (rowIds.length === 0) {
    await fetch("/api/scatter-selection", { method: "DELETE" }).catch(() => {});
    return null;
  }
  await fetch("/api/scatter-selection", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ row_indices: rowIds }),
  }).catch(() => {});
  return largeSelectionPredicateLegacy();
}

/**
 * Build a Mosaic WHERE predicate for the given row IDs.
 *
 * Small selections (< 5000): `__row_index__ IN (1,2,3,...)`
 * DuckDB converts IN lists to hash sets — much faster than 100K OR clauses.
 * The inline id list varies per selection, so Mosaic's SQL-text cache key
 * naturally differs and no version tag is needed here.
 *
 * Large selections (≥ 5000): subquery against the __scatter_selection temp
 * table that is populated via POST /api/scatter-selection before this
 * predicate is applied. See syncLargeSelectionLegacy() (host-less path only;
 * the docked path uses host.api.publishSelection → sel_<id>).
 */
export function buildSelectionPredicate(rowIds: number[]): string | null {
  if (rowIds.length === 0) return null;
  if (rowIds.length < 5000) {
    return `__row_index__ IN (${rowIds.join(",")})`;
  }
  return largeSelectionPredicateLegacy();
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export interface UseScatterBrushSyncOptions {
  myPanelId: PanelId;
  rowIndicesRef: RefObject<number[]>;
  setSelection: (n: number | null) => void;
  /**
   * Optional out-ref that receives the *lasso* row IDs (mapped from GPU
   * buffer indices to app-level row indices). Used by the save-collection
   * sheet — `rowIndicesRef` is the panel-level mapping (all rows), this is
   * the actual user selection.
   */
  lassoRowIdsRef?: RefObject<number[]>;
}

export interface UseScatterBrushSyncResult {
  /** Stable callback to pass to ScatterGPUHost as onSelectionChange */
  onSelectionChange: (count: number | null, indices?: number[]) => void;
}

export function useScatterBrushSync({
  myPanelId,
  rowIndicesRef,
  setSelection,
  lassoRowIdsRef,
}: UseScatterBrushSyncOptions): UseScatterBrushSyncResult {
  // Stable ref to capture myPanelId for use inside throttler/debouncer callbacks
  const panelIdRef = useRef(myPanelId);
  panelIdRef.current = myPanelId;

  // When this scatter is mounted as a plugin (docked path), route selection-out
  // through host.* instead of the global stores; the floating/host-less path
  // keeps the legacy direct-store writes (host === null). Read via a ref so the
  // throttler/debouncer closures see the current host.
  const host = useOptionalHost();
  const hostRef = useRef(host);
  hostRef.current = host;

  // ── Live + debounced activeFilterStore update ─────────────────────────────
  // Visual feedback (point dimming, status bar count) stays immediate.
  //
  // Two-tier strategy matched to selection size:
  //  • Small (<5000 rows): throttle at ~50ms = same rate as GPU readback.
  //    Table updates live while drawing. Uses fast IN-list predicate.
  //  • Large (≥5000 rows): debounce 200ms. Creates a temp DuckDB table —
  //    too expensive to fire every 50ms. Wait for the user to pause.
  //
  // The debouncer also fires a trailing accurate update for small selections
  // (usually a no-op since the throttler already set the same predicate).
  //
  // NOTE: setLassoFilter / clearLassoFilter write to ActiveFilterStore's
  // lasso facet. DashboardProvider is the SOLE caller of
  // brushSelection.update() — it subscribes and dispatches via rAF.
  const brushThrottler = useThrottler(
    (rowIds: number[]) => {
      if (rowIds.length === 0 || rowIds.length >= 5000) return;
      const predicate = buildSelectionPredicate(rowIds);
      const h = hostRef.current;
      if (h) h.publishPredicate("lasso", predicate);
      else setLassoFilter(panelIdRef.current, predicate);
    },
    {
      wait: 50, // matches GPU readback gate (~20 fps)
      leading: true, // fire immediately on first readback
      trailing: true, // one final update when drawing stops
    },
  );

  const brushDebouncer = useDebouncer(
    async (rowIds: number[]) => {
      const h = hostRef.current;
      // Small (<5000): inline IN-list, host-agnostic (the id list self-busts the cache).
      if (rowIds.length < 5000) {
        const predicate = buildSelectionPredicate(rowIds);
        if (h) h.publishPredicate("lasso", predicate);
        else setLassoFilter(panelIdRef.current, predicate);
        return;
      }
      // Large (≥5000): stage server-side, then reference the temp table.
      if (h?.api.publishSelection) {
        // Per-instance sel_<id> (§6.5). Bail if the instance is being torn down so
        // a flush-after-dispose can't strand an orphaned sel_<id> table.
        if (h.signal.aborted) return;
        const token = await h.api.publishSelection(rowIds);
        if (h.signal.aborted) return;
        h.publishPredicate("lasso", token.predicate); // references sel_<id> + /* tok=N */
        return;
      }
      // Floating / host-less (or no selection-out): legacy fixed __scatter_selection.
      const predicate = await syncLargeSelectionLegacy(rowIds);
      if (h) h.publishPredicate("lasso", predicate);
      else setLassoFilter(panelIdRef.current, predicate);
    },
    {
      wait: 200,
      leading: false,
      trailing: true,
      // Guarantee the table syncs if the component unmounts mid-lasso
      onUnmount: (d) => d.flush(),
    },
  );

  const onSelectionChange = (_count: number | null, indices?: number[]) => {
    const rowIds = (indices ?? []).map((i) => rowIndicesRef.current[i] ?? i);
    setSelection(rowIds.length > 0 ? rowIds.length : null); // status bar — immediate
    if (lassoRowIdsRef) lassoRowIdsRef.current = rowIds;

    if (rowIds.length === 0) {
      // Clear is time-sensitive — cancel both and update right away
      brushThrottler.cancel();
      brushDebouncer.cancel();
      if (host) {
        host.publishPredicate("lasso", null);
        host.clearRowSet(); // true clear — NOT publishRowSet([])
        host.api.disposeSelection?.(); // drop sel_<id> on explicit lasso clear (§6.5)
      } else {
        clearLassoFilter(myPanelId);
        clearSelectionSync(panelSource(myPanelId));
      }
    } else {
      brushThrottler.maybeExecute(rowIds); // live update for small selections (~50ms)
      brushDebouncer.maybeExecute(rowIds); // debounced final + large selections (200ms)
      if (host) host.publishRowSet(rowIds);
      else broadcastSelection(panelSource(myPanelId), rowIds);
    }
  };

  return { onSelectionChange };
}
