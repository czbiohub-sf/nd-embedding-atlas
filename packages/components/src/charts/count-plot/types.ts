import type { ChartLeafConfig } from "../core/types";

export interface CountPlotConfig extends ChartLeafConfig {
  limit: number;
}

export type CountPlotOptions = Record<string, never>;
