/**
 * The React bridge for a node's cooked input predicate, mirroring `useNodeFocus`.
 *
 * `host.inputPredicate` is a Mosaic Selection that MUTATES IN PLACE when the graph
 * re-cooks and announces it with a "value" event. React never learns about that on
 * its own, so any view deriving state from the predicate — a query key, an unwired
 * gate, a scope-dependent list — must subscribe or it silently serves stale results
 * after an upstream filter changes.
 *
 * Reading it with a bare `predicateToSql(host.inputPredicate)` during render is the
 * bug this exists to prevent.
 */

import type { Selection } from "@uwdata/mosaic-core";
import { useCallback, useSyncExternalStore } from "react";
import { predicateToSql } from "./mosaic";

/**
 * Subscribe to `selection` and return its predicate as SQL, or null when the node
 * is unwired. The snapshot is a string, so React's identity check settles.
 */
export function useInputPredicateSql(selection: Selection): string | null {
  const subscribe = useCallback(
    (onChange: () => void) => {
      selection.addEventListener("value", onChange);
      return () => selection.removeEventListener("value", onChange);
    },
    [selection],
  );
  return useSyncExternalStore(subscribe, () => predicateToSql(selection));
}
