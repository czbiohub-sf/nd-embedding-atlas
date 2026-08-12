import { useDebouncer, useThrottler } from "@tanstack/react-pacer";
import type { RowIndex } from "@ndea/sdk";
import type { RefObject } from "react";
import { useCallback, useEffect, useRef } from "react";
import { useHost } from "@/core/host/host-context";
import { clearLasso, disposeStagedLasso, publishLasso, stageLassoRowSet } from "@/nodes/scatter/routing";
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
  // Selection-out routes through the stable filter host. Read via a ref so the
  // throttler/debouncer closures see the current host.
  const host = useHost<unknown, ScatterCapabilities>();
  const hostRef = useRef(host);
  hostRef.current = host;
  const revisionRef = useRef(0);
  const latestRequiresStagingRef = useRef(false);
  const publicationQueueRef = useRef(Promise.resolve());
  const trackCleanup = useCallback((cleanup: Promise<void>) => {
    const pending = Promise.all([publicationQueueRef.current, cleanup]).then(() => {});
    publicationQueueRef.current = pending.catch(() => {});
  }, []);

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
    ({ rowIds, revision }: { rowIds: RowIndex[]; revision: number }) => {
      if (rowIds.length === 0 || rowIds.length >= 5000) return;
      if (revision !== revisionRef.current) return;
      trackCleanup(disposeStagedLasso(hostRef.current));
      publishLasso(hostRef.current, buildInlineSelectionPredicate(rowIds), rowIds);
    },
    {
      wait: 50, // matches GPU readback gate (~20 fps)
      leading: true, // fire immediately on first readback
      trailing: true, // one final update when drawing stops
    },
  );

  const brushDebouncer = useDebouncer(
    async ({ rowIds, revision }: { rowIds: RowIndex[]; revision: number }) => {
      const h = hostRef.current;
      // Small (<5000): inline IN-list (the id list self-busts the cache).
      if (rowIds.length < 5000) {
        if (revision !== revisionRef.current) return;
        trackCleanup(disposeStagedLasso(h));
        publishLasso(h, buildInlineSelectionPredicate(rowIds), rowIds);
        return;
      }
      // Large (≥5000): stage server-side, then reference the temp table.
      // Serialize publications so an older response can never overwrite the
      // per-instance table after a newer selection.
      const publication = publicationQueueRef.current.then(async () => {
        if (h.signal.aborted || revision !== revisionRef.current) return;
        const predicate = await stageLassoRowSet(h, rowIds);
        if (h.signal.aborted) return;
        if (revision !== revisionRef.current) {
          if (!latestRequiresStagingRef.current) await disposeStagedLasso(h);
          return;
        }
        publishLasso(h, predicate, rowIds); // references sel_<id> + /* tok=N */
      });
      publicationQueueRef.current = publication.catch(() => {});
      await publication;
    },
    {
      wait: 200,
      leading: false,
      trailing: true,
    },
  );

  const throttlerRef = useRef(brushThrottler);
  throttlerRef.current = brushThrottler;
  const debouncerRef = useRef(brushDebouncer);
  debouncerRef.current = brushDebouncer;
  useEffect(
    () => () => {
      revisionRef.current += 1;
      latestRequiresStagingRef.current = false;
      throttlerRef.current.cancel();
      debouncerRef.current.cancel();
      trackCleanup(clearLasso(hostRef.current));
    },
    [trackCleanup],
  );

  const onSelectionChange = (_count: number | null, indices?: GpuPointIndex[]) => {
    const rowIds = (indices ?? [])
      .map((pointIndex) => rowIndicesRef.current[pointIndex])
      .filter((value): value is RowIndex => value != null);
    const revision = ++revisionRef.current;
    latestRequiresStagingRef.current = rowIds.length >= 5000;
    setSelection(rowIds.length > 0 ? rowIds.length : null); // status bar: immediate

    if (rowIds.length === 0) {
      // Clear is time-sensitive: cancel both and update right away
      brushThrottler.cancel();
      brushDebouncer.cancel();
      trackCleanup(clearLasso(host)); // drop facet and staged sel_<id>
    } else {
      const selection = { rowIds, revision };
      brushThrottler.maybeExecute(selection); // live update for small selections (~50ms)
      brushDebouncer.maybeExecute(selection); // debounced final + large selections (200ms)
    }
  };

  return { onSelectionChange };
}
