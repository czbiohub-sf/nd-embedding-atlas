import { useDebouncer, useThrottler } from "@tanstack/react-pacer";
import type { RefObject } from "react";
import { useRef } from "react";
import { useOptionalHost } from "../../core/host/host-context";
import { clearLassoFilter, setLassoFilter } from "../../stores/ActiveFilterStore";
import { broadcastSelection, clearSelectionSync, panelSource } from "../../stores/SelectionSyncStore";
import type { PanelId } from "../types";

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Mosaic's QueryManager caches query results by raw SQL text. Large-selection
 * predicates always read the same temp table (__scatter_selection), so the
 * cache-key string would be identical across different lassos and return stale
 * counts. Suffixing the predicate with a per-selection tag makes the SQL
 * unique per lasso — the extra `AND ''=''` is a no-op at execution time.
 */
let largeSelectionVersion = 0;

function largeSelectionPredicate(): string {
  largeSelectionVersion++;
  return `__row_index__ IN (SELECT row_index FROM __scatter_selection) AND 'v${largeSelectionVersion}' = 'v${largeSelectionVersion}'`;
}

async function syncLargeSelection(rowIds: number[]): Promise<string | null> {
  if (rowIds.length === 0) {
    await fetch("/api/scatter-selection", { method: "DELETE" }).catch(() => {});
    return null;
  }
  await fetch("/api/scatter-selection", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ row_indices: rowIds }),
  }).catch(() => {});
  return largeSelectionPredicate();
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
 * predicate is applied. See syncLargeSelection().
 */
export function buildSelectionPredicate(rowIds: number[]): string | null {
  if (rowIds.length === 0) return null;
  if (rowIds.length < 5000) {
    return `__row_index__ IN (${rowIds.join(",")})`;
  }
  return largeSelectionPredicate();
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
      // Compute the predicate first (the large branch's /api/scatter-selection
      // POST + version-suffix stays here — per-instance namespacing is Phase 3).
      const predicate =
        rowIds.length < 5000
          ? // Small: throttler already updated live; ensure final predicate is accurate.
            buildSelectionPredicate(rowIds)
          : // Large: expensive temp-table sync — only run after drawing stops.
            await syncLargeSelection(rowIds);
      const h = hostRef.current;
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
