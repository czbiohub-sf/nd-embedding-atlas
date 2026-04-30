import type { RefObject } from "react";
import { useCallback } from "react";
import type { IsolationCapability } from "../handle-capabilities";

interface UseDisabledBridgeOptions {
  scatterRef: { readonly current: IsolationCapability | null };
  categoryIndicesRef: RefObject<Uint8Array | null>;
}

interface UseDisabledBridgeResult {
  handleDisabledChange: (disabledIndices: Set<number>) => void;
}

/**
 * Bridges legend "disabled" state (left-click on a category dot to hide it)
 * to the GPU click-filter so disabled-category points become unclickable.
 *
 * Render-side alpha=0 is already applied through the effectiveCategoryColors
 * map in LegendContext — this hook only needs to propagate the disabled set
 * to `setCategoryDisabled` on the scatter handle so `isPointVisible` returns
 * false for those points.
 *
 * Distinct from useIsolationBridge: that one ALSO writes a Mosaic predicate
 * to drive cross-filter. Disabled is purely visual + click semantics — it
 * doesn't (yet) participate in Mosaic. Add a predicate write here if/when
 * the product wants disabled categories filtered from tables/charts too.
 */
export function useDisabledBridge(opts: UseDisabledBridgeOptions): UseDisabledBridgeResult {
  const { scatterRef, categoryIndicesRef } = opts;

  const handleDisabledChange = useCallback(
    (disabledIndices: Set<number>) => {
      const scatter = scatterRef.current;
      if (!scatter) return;
      const catIndices = categoryIndicesRef.current;
      if (!catIndices) {
        scatter.clearCategoryDisabled();
        return;
      }
      if (disabledIndices.size === 0) {
        scatter.clearCategoryDisabled();
        return;
      }
      scatter.setCategoryDisabled(disabledIndices, catIndices);
    },
    [scatterRef, categoryIndicesRef],
  );

  return { handleDisabledChange };
}
