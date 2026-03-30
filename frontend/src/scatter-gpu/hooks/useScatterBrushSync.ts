import { useRef } from "react";
import type { RefObject } from "react";
import { useThrottler, useDebouncer } from "@tanstack/react-pacer";
import type { PanelId } from "../types";
import { broadcastSelection, clearSelectionSync } from "../../providers/SelectionSyncStore";
import { setActiveFilter, clearActiveFilter } from "../../providers/ActiveFilterStore";

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Build a Mosaic WHERE predicate for the given row IDs.
 *
 * Small selections (< 5000): `__row_index__ IN (1,2,3,...)`
 * DuckDB converts IN lists to hash sets — much faster than 100K OR clauses.
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
  return `__row_index__ IN (SELECT row_index FROM __scatter_selection)`;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export interface UseScatterBrushSyncOptions {
  myPanelId: PanelId;
  rowIndicesRef: RefObject<number[]>;
  setSelection: (n: number | null) => void;
}

export interface UseScatterBrushSyncResult {
  /** Stable callback to pass to ScatterGPUHost as onSelectionChange */
  onSelectionChange: (count: number | null, indices?: number[]) => void;
}

export function useScatterBrushSync({
  myPanelId,
  rowIndicesRef,
  setSelection,
}: UseScatterBrushSyncOptions): UseScatterBrushSyncResult {
  // Stable ref to capture myPanelId for use inside throttler/debouncer callbacks
  const panelIdRef = useRef<PanelId>(myPanelId);
  panelIdRef.current = myPanelId;

  // ── Large-selection temp table sync ──────────────────────────────────────
  // For selections ≥ 5000 rows, populate a DuckDB temp table before updating
  // the Mosaic predicate. The table query then uses a subquery instead of a
  // massive IN list. Smaller selections use IN (ids) directly — no server call.
  const syncLargeSelection = async (rowIds: number[]) => {
    if (rowIds.length === 0) {
      await fetch("/api/scatter-selection", { method: "DELETE" }).catch(() => {});
      return null;
    }
    await fetch("/api/scatter-selection", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ row_indices: rowIds }),
    }).catch(() => {});
    return `__row_index__ IN (SELECT row_index FROM __scatter_selection)`;
  };

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
  // NOTE: setActiveFilter / clearActiveFilter write to ActiveFilterStore.
  // DashboardProvider is the SOLE caller of brushSelection.update() — it
  // subscribes to this store and dispatches via requestAnimationFrame.
  const brushThrottler = useThrottler(
    (rowIds: number[]) => {
      if (rowIds.length === 0 || rowIds.length >= 5000) return;
      const predicate = buildSelectionPredicate(rowIds);
      setActiveFilter(panelIdRef.current, predicate);
    },
    {
      wait: 50, // matches GPU readback gate (~20 fps)
      leading: true, // fire immediately on first readback
      trailing: true, // one final update when drawing stops
    },
  );

  const brushDebouncer = useDebouncer(
    async (rowIds: number[]) => {
      if (rowIds.length < 5000) {
        // Small: throttler already updated live; ensure final predicate is accurate.
        const predicate = buildSelectionPredicate(rowIds);
        setActiveFilter(panelIdRef.current, predicate);
      } else {
        // Large: expensive temp-table sync — only run after drawing stops.
        const predicate = await syncLargeSelection(rowIds);
        setActiveFilter(panelIdRef.current, predicate);
      }
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

    if (rowIds.length === 0) {
      // Clear is time-sensitive — cancel both and update right away
      brushThrottler.cancel();
      brushDebouncer.cancel();
      clearActiveFilter(myPanelId);
      clearSelectionSync(myPanelId);
    } else {
      brushThrottler.maybeExecute(rowIds); // live update for small selections (~50ms)
      brushDebouncer.maybeExecute(rowIds); // debounced final + large selections (200ms)
      broadcastSelection(myPanelId, rowIds);
    }
  };

  return { onSelectionChange };
}
