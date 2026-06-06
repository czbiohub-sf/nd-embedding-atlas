import type { RefObject } from "react";
import { useCallback, useRef } from "react";
import { useOptionalHost } from "../../core/host/host-context";
import type { CategoryMapping } from "../../lib/category-column";
import { setBrushPredicate } from "../../stores/BrushPredicateStore";
import type { IsolationCapability } from "../handle-capabilities";

interface UseIsolationBridgeOptions {
  coloredCategoryMapping: CategoryMapping | null;
  colorByColumn: string | null;
  scatterRef: { readonly current: IsolationCapability | null };
  categoryIndicesRef: RefObject<Uint8Array | null>;
}

interface UseIsolationBridgeResult {
  handleIsolationChange: (isolatedIndices: Set<number>) => void;
}

/**
 * Bridges legend isolation state to:
 *  1. Mosaic's BrushPredicateStore — drives cross-filter (table, charts).
 *  2. ScatterGPUHost.setCategoryIsolation — drives GPU alpha-dimming.
 *
 * Each feature owns its own isolation mask in the GPU selection engine,
 * so this hook writes unconditionally — no trajectory/continuous guards needed.
 */
export function useIsolationBridge(opts: UseIsolationBridgeOptions): UseIsolationBridgeResult {
  const { coloredCategoryMapping, colorByColumn, scatterRef, categoryIndicesRef } = opts;

  const isolationSourceRef = useRef<object>({});
  const catMapRef = useRef(coloredCategoryMapping);
  catMapRef.current = coloredCategoryMapping;
  const colByColRef = useRef(colorByColumn);
  colByColRef.current = colorByColumn;
  // Route the isolation predicate through host.* on the plugin path; the
  // floating/host-less path falls back to the legacy BrushPredicateStore write.
  const host = useOptionalHost();
  const hostRef = useRef(host);
  hostRef.current = host;

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const handleIsolationChange = useCallback(
    (isolatedIndices: Set<number>) => {
      const source = isolationSourceRef.current;
      const catMap = catMapRef.current;
      const col = colByColRef.current;
      const catIndices = categoryIndicesRef.current;
      const scatter = scatterRef.current;
      const currentHost = hostRef.current;
      const publishIsolation = (sql: string | null) => {
        if (currentHost) currentHost.publishPredicate("isolation", sql);
        else setBrushPredicate(source, sql);
      };

      if (isolatedIndices.size === 0 || !catMap || !col) {
        publishIsolation(null);
        scatter?.clearCategoryIsolation();
        return;
      }

      const labels = catMap.legend
        .filter((item) => isolatedIndices.has(item.index))
        .map((item) => `'${item.label.replace(/'/g, "''")}'`);
      if (labels.length === 0) {
        publishIsolation(null);
        scatter?.clearCategoryIsolation();
        return;
      }
      publishIsolation(`${col} IN (${labels.join(", ")})`);

      if (scatter && catIndices) {
        scatter.setCategoryIsolation(isolatedIndices, catIndices);
      }
    },
    [categoryIndicesRef, scatterRef],
  );

  return { handleIsolationChange };
}
