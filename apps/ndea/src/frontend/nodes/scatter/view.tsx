/**
 * Scatter plugin view (PLUGIN-ARCHITECTURE §10.1).
 *
 * Phase 1: a thin, behavior-preserving wrapper over the already
 * container-agnostic `ScatterContent`. It reads only `host.instanceId`
 * (= panelId) and the serializable `config` ({ obsmKey, colorByColumn }).
 * The full host.* rewrite of ScatterContent's internals (device lease,
 * publishPredicate, externalRowSet) lands in Phase 2.
 */

import { ScatterContent } from "@/nodes/scatter/ScatterContent";
import { HostProvider } from "@/core/host/host-context";
import { panelId } from "@/nodes/scatter/gpu/types";
import type { NodeBodyProps } from "@/core/node/app-node-host";

export interface ScatterConfig {
  obsmKey: string | null;
  colorByColumn: string | null;
}

/** Typed render options (editor deferred — decision #3); collapses PointRadius + RenderSettings. */
export interface ScatterOptions {
  pointRadius: number;
  pointOpacity: number;
}

export function ScatterPluginView({ host }: NodeBodyProps<ScatterConfig>) {
  // Put the host on context so the scatter subtree (incl. the GPU host's device
  // lease) can read host.* without prop-drilling. The Phase-2b conversion of
  // ScatterContent's internals to host.* consumes this same provider.
  return (
    <HostProvider host={host}>
      <ScatterContent
        panelId={panelId(host.instanceId)}
        initialObsmKey={host.config.obsmKey}
        initialColorByColumn={host.config.colorByColumn}
        // workspace containers expose a header slot — the toolbar rides the
        // node/tile header there; containers without one get the docked row
        toolbarTarget={host.bodyHeaderElement}
      />
    </HostProvider>
  );
}
