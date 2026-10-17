import { useDebouncer } from "@tanstack/react-pacer";
import type { RowIndex } from "@ndea/sdk";
import type { RefObject } from "react";
import { useEffect, useRef } from "react";
import { useScatterHost } from "../../context";
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
  useEffect(() => {
    hostRef.current = host;
  }, [host]);
  const revisionRef = useRef(0);
  const queueRef = useRef(Promise.resolve());
  const brushDebouncer = useDebouncer(
    ({ rowIds, revision }: { rowIds: RowIndex[]; revision: number }) => {
      const h = hostRef.current;
      queueRef.current = queueRef.current.then(async () => {
        if (h.signal.aborted || revision !== revisionRef.current) return;
        try {
          const { set } = await h.dataAPI.createObservationSet(rowIds);
          if (!h.signal.aborted && revision === revisionRef.current) h.filter.publish("lasso", { op: "inSet", set });
        } catch (error) {
          if (!h.signal.aborted && revision === revisionRef.current) {
            h.notifications.notify(error instanceof Error ? error.message : String(error), "error");
          }
        }
      });
    },
    { wait: 200, leading: false, trailing: true },
  );
  useEffect(
    () => () => {
      revisionRef.current += 1;
      brushDebouncer.cancel();
      hostRef.current.filter.clear("lasso");
    },
    [brushDebouncer],
  );

  const onSelectionChange = (_count: number | null, indices?: GpuPointIndex[]) => {
    const rowIds = (indices ?? [])
      .map((pointIndex) => rowIndicesRef.current[pointIndex])
      .filter((value): value is RowIndex => value != null);
    const revision = ++revisionRef.current;
    setSelection(rowIds.length > 0 ? rowIds.length : null);
    if (rowIds.length === 0) {
      brushDebouncer.cancel();
      host.filter.clear("lasso");
    } else {
      brushDebouncer.maybeExecute({ rowIds, revision });
    }
  };
  return { onSelectionChange };
}
