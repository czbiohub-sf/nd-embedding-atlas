/**
 * Charts plugin view (PLUGIN-ARCHITECTURE §10.3).
 *
 * Phase 1: renders the existing `ChartPanelList` unchanged (it reads
 * `DashboardState.panels` internally). Phase 3 moves `ChartSpec[]` into this
 * plugin's `config` and routes the `CountPlot`/`Histogram`
 * `brushSelection.update()` bypass through `host.publishPredicate("chart", …)`.
 */

import { ChartPanelList } from "@/components/charts/ChartPanelList";
import type { PluginViewProps } from "@/core/plugin/types";

export interface ChartsConfig {
  /** Reserved: per-instance chart specs (Phase 3). */
  specs: null;
}

export type ChartsOptions = Record<string, never>;

export function ChartsPluginView(_props: PluginViewProps<ChartsConfig, ChartsOptions>) {
  return (
    <div className="h-full w-full overflow-y-auto bg-card">
      <ChartPanelList />
    </div>
  );
}
