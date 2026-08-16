import type { ChartLeafConfig } from "../core/types";

export interface HistogramConfig extends ChartLeafConfig {
  bins: number;
}

export type HistogramOptions = Record<string, never>;
export type HistogramCapabilities = "data-read" | "filter-coordination";
