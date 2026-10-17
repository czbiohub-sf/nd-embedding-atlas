import { useEffect, useRef } from "react";
import { useScatterHost } from "../../context";

export interface UseScatterBrushSyncOptions {
  /** Points in the scatter = observations (point index = row index). */
  numPoints: number;
  setSelection: (n: number | null) => void;
}

export interface UseScatterBrushSyncResult {
  onSelectionChange: (count: number | null, bits?: Uint32Array<ArrayBuffer>) => void;
}

/**
 * Drag readbacks (no `bits`) only update the count. The pointer-up readback
 * carries the lasso bit layer, which is the row bitmask: it becomes a
 * content-addressed set, published as `{ op: "inSet", set }`.
 */
export function useScatterBrushSync({
  numPoints,
  setSelection,
}: UseScatterBrushSyncOptions): UseScatterBrushSyncResult {
  const host = useScatterHost();
  const hostRef = useRef(host);
  useEffect(() => {
    hostRef.current = host;
  }, [host]);
  const revisionRef = useRef(0);
  const queueRef = useRef(Promise.resolve());
  useEffect(
    () => () => {
      revisionRef.current += 1;
      hostRef.current.filter.clear("lasso");
    },
    [],
  );

  const onSelectionChange = (count: number | null, bits?: Uint32Array<ArrayBuffer>) => {
    setSelection(count === 0 ? null : count);
    if (count !== null && bits === undefined) return;
    const revision = ++revisionRef.current;
    if (!count || !bits) {
      host.filter.clear("lasso");
      return;
    }
    queueRef.current = queueRef.current.then(async () => {
      if (host.signal.aborted || revision !== revisionRef.current) return;
      try {
        const { set } = await host.dataAPI.createObservationSet(bits, numPoints);
        if (!host.signal.aborted && revision === revisionRef.current)
          host.filter.publish("lasso", { op: "inSet", set });
      } catch (error) {
        if (!host.signal.aborted && revision === revisionRef.current) {
          host.notifications.notify(error instanceof Error ? error.message : String(error), "error");
        }
      }
    });
  };
  return { onSelectionChange };
}
