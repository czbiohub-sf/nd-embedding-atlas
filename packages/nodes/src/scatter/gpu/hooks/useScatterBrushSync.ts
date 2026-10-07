import { useDebouncer } from "@tanstack/react-pacer";
import type { RowIndex } from "@ndea/sdk";
import type { RefObject } from "react";
import { useEffect, useRef } from "react";
import { useScatterHost } from "../../context";
import { clearLasso, publishLasso } from "../../routing";
import type { GpuPointIndex } from "../../contracts";

export interface UseScatterBrushSyncOptions {
  rowIndicesRef: RefObject<RowIndex[]>;
  setSelection: (n: number | null) => void;
}

export interface UseScatterBrushSyncResult {
  onSelectionChange: (count: number | null, indices?: GpuPointIndex[]) => void;
}

export function useScatterBrushSync({
  rowIndicesRef,
  setSelection,
}: UseScatterBrushSyncOptions): UseScatterBrushSyncResult {
  const host = useScatterHost();
  const hostRef = useRef(host);
  hostRef.current = host;
  const revisionRef = useRef(0);
  const queueRef = useRef(Promise.resolve());
  const brushDebouncer = useDebouncer(
    ({ rowIds, revision }: { rowIds: RowIndex[]; revision: number }) => {
      const h = hostRef.current;
      queueRef.current = queueRef.current.then(async () => {
        if (h.signal.aborted || revision !== revisionRef.current) return;
        try {
          const { set } = await h.dataAPI.createObservationSet(rowIds);
          if (!h.signal.aborted && revision === revisionRef.current) publishLasso(h, { op: "inSet", set });
        } catch (error) {
          if (!h.signal.aborted && revision === revisionRef.current) {
            h.notifications.notify(error instanceof Error ? error.message : String(error), "error");
          }
        }
      });
    },
    { wait: 200, leading: false, trailing: true },
  );
  const debouncerRef = useRef(brushDebouncer);
  debouncerRef.current = brushDebouncer;
  useEffect(
    () => () => {
      revisionRef.current += 1;
      debouncerRef.current.cancel();
      clearLasso(hostRef.current);
    },
    [],
  );

  const onSelectionChange = (_count: number | null, indices?: GpuPointIndex[]) => {
    const rowIds = (indices ?? [])
      .map((pointIndex) => rowIndicesRef.current[pointIndex])
      .filter((value): value is RowIndex => value != null);
    const revision = ++revisionRef.current;
    setSelection(rowIds.length > 0 ? rowIds.length : null);
    if (rowIds.length === 0) {
      brushDebouncer.cancel();
      clearLasso(host);
    } else {
      brushDebouncer.maybeExecute({ rowIds, revision });
    }
  };
  return { onSelectionChange };
}
