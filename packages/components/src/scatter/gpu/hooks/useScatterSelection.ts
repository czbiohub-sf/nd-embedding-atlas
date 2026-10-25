import { type RefObject, useEffect, useRef, useState } from "react";
import { useScatterHost } from "../../context";
import type { SelectionCombine } from "../../contracts";
import { combineSelection, invertSelection, isEmptySelection } from "../../selection-bits";
import type { SelectionCapability } from "../handle-capabilities";

/** A published selection: the exact `count` and `set` returned by `POST /api/sets`. */
export interface ScatterSelectionState {
  count: number;
  set: string;
  tool: "box" | "lasso";
}

export interface ScatterSelection {
  /** null until the set is created (and after Clear). */
  state: ScatterSelectionState | null;
  onSelectionChange(count: number | null, bits?: Uint32Array<ArrayBuffer>, combine?: SelectionCombine): void;
  /** Re-show the selection on a fresh GPU instance (it starts blank). */
  restore(): void;
  invert(): void;
  clear(): boolean;
  saveAsSource(): void;
}

/**
 * The view's box/lasso selection, kept CPU-side as a row-order bitmask. A drawn
 * shape combines with it (shift adds, ⌥ subtracts), is shown on the GPU, becomes
 * a content-addressed set, and is published as `{ op: "inSet", set }` on this
 * element's `lasso` filter facet. Drag readbacks (no `bits`) are ignored.
 */
export function useScatterSelection({
  numPoints,
  gpuRef,
  tool,
}: {
  /** Points in the scatter = observations (point index = row index). */
  numPoints: number;
  gpuRef: RefObject<SelectionCapability | null>;
  tool: "box" | "lasso";
}): ScatterSelection {
  const host = useScatterHost();
  const hostRef = useRef(host);
  useEffect(() => {
    hostRef.current = host;
  }, [host]);
  const [state, setState] = useState<ScatterSelectionState | null>(null);
  const bitsRef = useRef<Uint32Array<ArrayBuffer> | null>(null);
  const revisionRef = useRef(0);
  const queueRef = useRef(Promise.resolve());
  useEffect(
    () => () => {
      revisionRef.current += 1;
      hostRef.current.filter.clear("lasso");
    },
    [],
  );

  const reset = () => {
    revisionRef.current += 1;
    bitsRef.current = null;
    setState(null);
    host.filter.clear("lasso");
  };

  const apply = (bits: Uint32Array<ArrayBuffer>, label: "box" | "lasso") => {
    // Clearing the GPU selection reports `null`, which resets.
    if (isEmptySelection(bits)) {
      if (gpuRef.current) gpuRef.current.clearSelection();
      else reset();
      return;
    }
    bitsRef.current = bits;
    gpuRef.current?.setSelectionBits(bits);
    const revision = ++revisionRef.current;
    queueRef.current = queueRef.current.then(async () => {
      if (host.signal.aborted || revision !== revisionRef.current) return;
      try {
        const { set, count } = await host.dataAPI.createObservationSet(bits, numPoints);
        if (host.signal.aborted || revision !== revisionRef.current) return;
        host.filter.publish("lasso", { op: "inSet", set });
        setState({ count, set, tool: label });
      } catch (error) {
        if (!host.signal.aborted && revision === revisionRef.current) {
          host.notifications.notify(error instanceof Error ? error.message : String(error), "error");
        }
      }
    });
  };

  return {
    state,
    onSelectionChange(count, bits, combine) {
      if (count === null) reset();
      else if (bits) apply(combineSelection(bitsRef.current, bits, combine ?? "replace"), tool);
    },
    restore() {
      if (bitsRef.current) gpuRef.current?.setSelectionBits(bitsRef.current);
    },
    invert() {
      if (bitsRef.current) apply(invertSelection(bitsRef.current, numPoints), state?.tool ?? tool);
    },
    clear() {
      if (!bitsRef.current) return false;
      if (gpuRef.current) gpuRef.current.clearSelection();
      else reset();
      return true;
    },
    saveAsSource() {
      if (!state) return;
      const name = host.dataAPI.saveSource("Selection", { op: "inSet", set: state.set });
      host.notifications.notify(`Saved source ${name} · ${state.count.toLocaleString()} obs`);
    },
  };
}
