import type { RefObject } from "react";
import { useCallback, useRef } from "react";
import { useHost } from "@/core/host/host-context";
import type { CategoryMapping } from "@/lib/color/category-column";
import type { IsolationCapability } from "@/nodes/scatter/gpu/handle-capabilities";
import type { ScatterCapabilities } from "@/nodes/scatter/plugin";

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
 *  1. The SelectionBus "isolation" facet — composes into the scatter instance's
 *     crossfilter clause, so isolation filters the table + charts (§6.3).
 *  2. ScatterGPUHost.setCategoryIsolation — drives GPU alpha-dimming.
 *
 * Each feature owns its own isolation mask in the GPU selection engine,
 * so this hook writes unconditionally — no trajectory/continuous guards needed.
 */
export function useIsolationBridge(opts: UseIsolationBridgeOptions): UseIsolationBridgeResult {
  const { coloredCategoryMapping, colorByColumn, scatterRef, categoryIndicesRef } = opts;

  const catMapRef = useRef(coloredCategoryMapping);
  catMapRef.current = coloredCategoryMapping;
  const colByColRef = useRef(colorByColumn);
  colByColRef.current = colorByColumn;
  // Isolation predicate composes into this scatter instance's crossfilter clause
  // via the host "isolation" facet (§6.3).
  const host = useHost<unknown, ScatterCapabilities>();
  const hostRef = useRef(host);
  hostRef.current = host;

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const handleIsolationChange = useCallback(
    (isolatedIndices: Set<number>) => {
      const catMap = catMapRef.current;
      const col = colByColRef.current;
      const catIndices = categoryIndicesRef.current;
      const scatter = scatterRef.current;
      const currentHost = hostRef.current;
      const publishIsolation = (sql: string | null) => {
        currentHost.publishPredicate("isolation", sql);
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
