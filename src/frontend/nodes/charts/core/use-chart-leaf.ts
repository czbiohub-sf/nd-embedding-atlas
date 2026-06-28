/**
 * The host-sourced surface every chart variant shares (replaces the old
 * `useDashboard().meta` + `selectionBus` reads). Data comes from `host.data`;
 * the chart's query is scoped to `host.inputSelection` (passed straight to
 * `useMosaicClient`, which reacts to its in-place mutation via Mosaic — no React
 * bridge needed). The plotted column lives in `host.config.field`.
 */

import type { Coordinator, Selection } from "@uwdata/mosaic-core";
import { useCallback } from "react";
import type { NodeHost } from "@/core/node/host";
import type { ChartLeafConfig } from "./types";

export interface ChartLeaf {
  coordinator: Coordinator;
  table: string;
  /** Mosaic Selection scoping the chart's query (the cooked input edge). */
  inputSelection: Selection;
  /** The plotted column, or null until picked. */
  field: string | null;
  setField: (field: string) => void;
}

export function useChartLeaf<C extends ChartLeafConfig>(host: NodeHost<C>): ChartLeaf {
  const setField = useCallback((field: string) => host.patchConfig({ field } as Partial<C>), [host]);
  return {
    coordinator: host.data.coordinator,
    table: host.data.table,
    inputSelection: host.inputSelection,
    field: host.config.field,
    setField,
  };
}
