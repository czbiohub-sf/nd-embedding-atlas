import { useCallback } from "react";
import type { IsolationCapability } from "../../gpu/handle-capabilities";

interface UseDisabledBridgeOptions {
  scatterRef: { readonly current: IsolationCapability | null };
}

interface UseDisabledBridgeResult {
  handleDisabledChange: (disabledIndices: Set<number>) => void;
}

/**
 * Bridges legend "disabled" state (left-click on a category dot to hide it) to
 * the GPU, which drops those points from drawing, picking, and lasso.
 *
 * Distinct from useIsolationBridge: that one ALSO writes a Mosaic predicate to
 * drive cross-filter. Disabled is purely visual + click semantics: it doesn't
 * (yet) participate in Mosaic.
 */
export function useDisabledBridge(opts: UseDisabledBridgeOptions): UseDisabledBridgeResult {
  const { scatterRef } = opts;

  const handleDisabledChange = useCallback(
    (disabledIndices: Set<number>) => {
      scatterRef.current?.setCategoryDisabled(disabledIndices);
    },
    [scatterRef],
  );

  return { handleDisabledChange };
}
