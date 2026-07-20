import { useDebouncer, useThrottler } from "@tanstack/react-pacer";
import type { RowIndex } from "@ndea/sdk";
import type { RefObject } from "react";
import { useRef } from "react";
import { useHost } from "@/core/host/host-context";
import { clearLasso, publishLasso, publishLassoRowSet } from "@/nodes/scatter/routing";
import type { ScatterCapabilities } from "@/nodes/scatter/plugin";
import type { GpuPointIndex } from "@/lib/branded-types";

/**
 * Build the inline Mosaic predicate used below the server-row-set threshold.
 * DuckDB converts IN lists to hash sets, and the changing IDs naturally make
 * each Mosaic query cache key distinct.
 */
function buildInlineSelectionPredicate(rowIds: readonly RowIndex[]): string | null {
  if (rowIds.length === 0) return null;
  return `__row_index__ IN (${rowIds.join(",")})`;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export interface UseScatterBrushSyncOptions {
  rowIndicesRef: RefObject<RowIndex[]>;
  setSelection: (n: number | null) => void;
}

export interface UseScatterBrushSyncResult {
  /** Stable callback to pass to ScatterGPUHost as onSelectionChange */
  onSelectionChange: (count: number | null, indices?: GpuPointIndex[]) => void;
}

export function useScatterBrushSync({
  rowIndicesRef,
  setSelection,
}: UseScatterBrushSyncOptions): UseScatterBrushSyncResult {
  // Selection-out routes through host.* (the bus is the sole crossfilter writer,
  // §6.3/§6.7). Read via a ref so the throttler/debouncer closures see the host.
  const host = useHost<unknown, ScatterCapabilities>();
  const hostRef = useRef(host);
  hostRef.current = host;

  // ── Live + debounced lasso-facet publish ──────────────────────────────────
  // Visual feedback (point dimming, status bar count) stays immediate.
  //
  // Two-tier strategy matched to selection size:
  //  • Small (<5000 rows): throttle at ~50ms = same rate as GPU readback.
  //    Table updates live while drawing. Uses fast IN-list predicate.
  //  • Large (≥5000 rows): debounce 200ms. Creates a temp DuckDB table :
  //    too expensive to fire every 50ms. Wait for the user to pause.
  //
  // The debouncer also fires a trailing accurate update for small selections
  // (usually a no-op since the throttler already set the same predicate).
  //
  const brushThrottler = useThrottler(
    (rowIds: RowIndex[]) => {
      if (rowIds.length === 0 || rowIds.length >= 5000) return;
      publishLasso(hostRef.current, buildInlineSelectionPredicate(rowIds));
    },
    {
      wait: 50, // matches GPU readback gate (~20 fps)
      leading: true, // fire immediately on first readback
      trailing: true, // one final update when drawing stops
    },
  );

  const brushDebouncer = useDebouncer(
    async (rowIds: RowIndex[]) => {
      const h = hostRef.current;
      // Small (<5000): inline IN-list (the id list self-busts the cache).
      if (rowIds.length < 5000) {
        publishLasso(h, buildInlineSelectionPredicate(rowIds));
        return;
      }
      // Large (≥5000): stage server-side, then reference the temp table.
      // Per-instance sel_<id> (§6.5). Bail if the instance is being torn down so
      // a flush-after-dispose can't strand an orphaned sel_<id> table.
      if (h.signal.aborted) return;
      const token = await h.dataAPI.publishRowSet(rowIds);
      if (h.signal.aborted) return;
      publishLasso(h, token.predicate); // references sel_<id> + /* tok=N */
    },
    {
      wait: 200,
      leading: false,
      trailing: true,
      // Guarantee the table syncs if the component unmounts mid-lasso
      onUnmount: (d) => d.flush(),
    },
  );

  const onSelectionChange = (_count: number | null, indices?: GpuPointIndex[]) => {
    const rowIds = (indices ?? [])
      .map((pointIndex) => rowIndicesRef.current[pointIndex])
      .filter((value): value is RowIndex => value != null);
    setSelection(rowIds.length > 0 ? rowIds.length : null); // status bar: immediate

    if (rowIds.length === 0) {
      // Clear is time-sensitive: cancel both and update right away
      brushThrottler.cancel();
      brushDebouncer.cancel();
      clearLasso(host); // drop facet + true-clear row-set + drop sel_<id> (§6.5)
    } else {
      brushThrottler.maybeExecute(rowIds); // live update for small selections (~50ms)
      brushDebouncer.maybeExecute(rowIds); // debounced final + large selections (200ms)
      publishLassoRowSet(host, rowIds);
    }
  };

  return { onSelectionChange };
}
