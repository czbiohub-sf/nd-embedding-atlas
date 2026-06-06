/**
 * Scatter plugin view (PLUGIN-ARCHITECTURE §10.1).
 *
 * Phase 1: a thin, behavior-preserving wrapper over the already
 * container-agnostic `ScatterContent`. It reads only `host.instanceId`
 * (= panelId), the container's Dockview `panelApi`, and the serializable
 * `config` ({ obsmKey, colorByColumn }). The full host.* rewrite of
 * ScatterContent's internals (device lease, publishPredicate, externalRowSet)
 * lands in Phase 2.
 */

import type { DockviewPanelApi } from "dockview-react";
import { ScatterContent } from "@/components/scatter/ScatterContent";
import { HostProvider } from "@/core/host/host-context";
import { panelId } from "@/scatter-gpu/types";
import type { PluginViewProps } from "@/core/plugin/types";

export interface ScatterConfig {
  obsmKey: string | null;
  colorByColumn: string | null;
}

/** Typed render options (editor deferred — decision #3); collapses PointRadius + RenderSettings. */
export interface ScatterOptions {
  pointRadius: number;
  pointOpacity: number;
}

export function ScatterPluginView({ host }: PluginViewProps<ScatterConfig, ScatterOptions>) {
  const panelApi = host.ui.container.panelApi as DockviewPanelApi | undefined;
  // Put the host on context so the scatter subtree (incl. the GPU host's device
  // lease) can read host.* without prop-drilling. The Phase-2b conversion of
  // ScatterContent's internals to host.* consumes this same provider.
  return (
    <HostProvider host={host}>
      <ScatterContent
        panelId={panelId(host.instanceId)}
        initialObsmKey={host.config.obsmKey}
        initialColorByColumn={host.config.colorByColumn}
        panelApi={panelApi}
      />
    </HostProvider>
  );
}
