import { useCallback, useRef } from "react";
import type { CategoryMapping } from "../../lib/category-column";
import { setBrushPredicate } from "../../providers/BrushPredicateStore";

interface UseIsolationBridgeOptions {
  coloredCategoryMapping: CategoryMapping | null;
  colorByColumn: string | null;
}

interface UseIsolationBridgeResult {
  /** Stable callback — safe to pass to LegendProvider onIsolationChange */
  handleIsolationChange: (isolatedIndices: Set<number>) => void;
}

/**
 * Bridges legend isolation state to Mosaic's BrushPredicateStore.
 *
 * Reads coloredCategoryMapping and colorByColumn via refs so the returned
 * callback is stable (never recreated). This prevents the LegendContext
 * useEffect from re-firing when only the callback reference changes — which
 * would call setBrushPredicate(null) and cancel any pending lasso Mosaic update.
 */
export function useIsolationBridge(opts: UseIsolationBridgeOptions): UseIsolationBridgeResult {
  const { coloredCategoryMapping, colorByColumn } = opts;

  const isolationSourceRef = useRef<object>({});
  const catMapRef = useRef(coloredCategoryMapping);
  catMapRef.current = coloredCategoryMapping;
  const colByColRef = useRef(colorByColumn);
  colByColRef.current = colorByColumn;

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const handleIsolationChange = useCallback((isolatedIndices: Set<number>) => {
    const source = isolationSourceRef.current;
    const catMap = catMapRef.current;
    const col = colByColRef.current;
    if (isolatedIndices.size === 0 || !catMap || !col) {
      setBrushPredicate(source, null);
      return;
    }
    const labels = catMap.legend
      .filter((item) => isolatedIndices.has(item.index))
      .map((item) => `'${item.label.replace(/'/g, "''")}'`);
    if (labels.length === 0) {
      setBrushPredicate(source, null);
      return;
    }
    setBrushPredicate(source, `${col} IN (${labels.join(", ")})`);
  }, []); // stable — reads catMap/col via refs, never recreated

  return { handleIsolationChange };
}
