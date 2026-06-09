/**
 * Charts plugin view (PLUGIN-ARCHITECTURE §10.3).
 *
 * Renders `ChartPanelList` (it reads `DashboardState.panels` internally). Each
 * chart leaf now publishes its filter as the "chart" facet of its OWN
 * SelectionBus instance (`chart:<panel.id>`, §6.3), so the legacy direct
 * `brushSelection.update()` bypass is gone and the bus is the sole writer.
 * Still deferred: moving `ChartSpec[]` into this plugin's `config` (needs
 * reactive options) and threading `host.data` to the leaves (§10.3).
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
