import type { RefObject } from "react";
import { useCallback, useRef } from "react";
import { useOptionalHost } from "../../core/host/host-context";
import { selectionBus } from "../../core/buses";
import type { CategoryMapping } from "../../lib/category-column";
import type { PanelId } from "../types";
import { floatingInstanceId } from "./useScatterBrushSync";
import type { IsolationCapability } from "../handle-capabilities";

interface UseIsolationBridgeOptions {
  coloredCategoryMapping: CategoryMapping | null;
  colorByColumn: string | null;
  scatterRef: { readonly current: IsolationCapability | null };
  categoryIndicesRef: RefObject<Uint8Array | null>;
  /** Panel id — used to derive the floating scatter's clause-source instance. */
  myPanelId: PanelId;
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
  const { coloredCategoryMapping, colorByColumn, scatterRef, categoryIndicesRef, myPanelId } = opts;

  const catMapRef = useRef(coloredCategoryMapping);
  catMapRef.current = coloredCategoryMapping;
  const colByColRef = useRef(colorByColumn);
  colByColRef.current = colorByColumn;
  // Route the isolation predicate through host.* on the plugin path; the
  // host-less floating window publishes to the bus directly under its floating
  // instance id (composing with that scatter's lasso/range, §6.3).
  const host = useOptionalHost();
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
        if (currentHost) currentHost.publishPredicate("isolation", sql);
        else selectionBus.publishPredicate(floatingInstanceId(myPanelId), "isolation", sql);
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
    [categoryIndicesRef, scatterRef, myPanelId],
  );

  return { handleIsolationChange };
}
