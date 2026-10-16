import type { FilterCoordinationAPI } from "@ndea/sdk";
import type { Coordinator } from "@uwdata/mosaic-core";
import { useCallback } from "react";
import type { ChartLeafConfig } from "./types";

export interface ChartLeaf {
  coordinator: Coordinator;
  table: string;
  filter: FilterCoordinationAPI;
  /** The plotted column, or null until picked. */
  field: string | null;
  setField: (field: string) => void;
}

interface ChartLeafHost<C extends ChartLeafConfig> {
  readonly config: C;
  readonly data: { coordinator: Coordinator; table: string };
  readonly filter: FilterCoordinationAPI;
  patchConfig(patch: Partial<C>): void;
}

export function useChartLeaf<C extends ChartLeafConfig>(host: ChartLeafHost<C>): ChartLeaf {
  const setField = useCallback((field: string) => host.patchConfig({ field } as Partial<C>), [host]);
  return {
    coordinator: host.data.coordinator,
    table: host.data.table,
    filter: host.filter,
    field: host.config.field,
    setField,
  };
}
