import type { RefObject } from "react";
import { useCallback, useRef } from "react";
import type { CategoryMapping } from "../../lib/category-column";
import { setBrushPredicate } from "../../stores/BrushPredicateStore";
import type { IsolationCapability } from "../handle-capabilities";

interface UseIsolationBridgeOptions {
  coloredCategoryMapping: CategoryMapping | null;
  colorByColumn: string | null;
  /** Ref to the GPU host — used to drive visual alpha-dimming on isolation. */
  scatterRef: { readonly current: IsolationCapability | null };
  /** Ref to per-point category palette indices — synced by ScatterView after data loads. */
  categoryIndicesRef: RefObject<Uint8Array | null>;
}

interface UseIsolationBridgeResult {
  /** Stable callback — safe to pass to LegendProvider onIsolationChange */
  handleIsolationChange: (isolatedIndices: Set<number>) => void;
}

/**
 * Bridges legend isolation state to:
 *  1. Mosaic's BrushPredicateStore — drives cross-filter (table, charts).
 *  2. ScatterGPUHost.setCategoryIsolation — drives alpha-only GPU dim effect.
 *
 * All mutable values (catMap, col, scatterRef, categoryIndices) are read via
 * refs so the returned callback is stable and never triggers re-renders.
 */
export function useIsolationBridge(opts: UseIsolationBridgeOptions): UseIsolationBridgeResult {
  const { coloredCategoryMapping, colorByColumn, scatterRef, categoryIndicesRef } = opts;

  const isolationSourceRef = useRef<object>({});
  const catMapRef = useRef(coloredCategoryMapping);
  catMapRef.current = coloredCategoryMapping;
  const colByColRef = useRef(colorByColumn);
  colByColRef.current = colorByColumn;

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const handleIsolationChange = useCallback(
    (isolatedIndices: Set<number>) => {
      const source = isolationSourceRef.current;
      const catMap = catMapRef.current;
      const col = colByColRef.current;
      const catIndices = categoryIndicesRef.current;
      const scatter = scatterRef.current;

      // ── Clear path ───────────────────────────────────────────────────────
      if (isolatedIndices.size === 0 || !catMap || !col) {
        setBrushPredicate(source, null);
        scatter?.clearCategoryIsolation();
        return;
      }

      // ── Mosaic cross-filter predicate ────────────────────────────────────
      const labels = catMap.legend
        .filter((item) => isolatedIndices.has(item.index))
        .map((item) => `'${item.label.replace(/'/g, "''")}'`);
      if (labels.length === 0) {
        setBrushPredicate(source, null);
        scatter?.clearCategoryIsolation();
        return;
      }
      setBrushPredicate(source, `${col} IN (${labels.join(", ")})`);

      // ── GPU alpha-dimming ────────────────────────────────────────────────
      if (scatter && catIndices) {
        scatter.setCategoryIsolation(isolatedIndices, catIndices);
      }
    },
    [categoryIndicesRef.current, scatterRef.current],
  ); // stable — reads all values via refs, never recreated

  return { handleIsolationChange };
}
