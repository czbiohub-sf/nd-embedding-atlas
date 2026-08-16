/**
 * Scatter plugin view (PLUGIN-ARCHITECTURE §10.1).
 *
 * Phase 1: a thin, behavior-preserving wrapper over the already
 * container-agnostic `ScatterContent`. It reads only `host.instanceId`
 * (= panelId) and the serializable `config` ({ obsmKey, colorByColumn }).
 * The full host.* rewrite of ScatterContent's internals (device lease,
 * filter facets, row-set publication) lands in Phase 2.
 */

import { ScatterContent } from "./ScatterContent";
import type { NodeBodyProps } from "../contracts";
import { ScatterProvider } from "./context";
import type { ScatterCapabilities, ScatterConfig, ScatterServices } from "./contracts";

export function createScatterView(services: ScatterServices) {
  return function ScatterPluginView({ host }: NodeBodyProps<ScatterConfig, ScatterCapabilities>) {
    return (
      <ScatterProvider host={host} services={services}>
        <ScatterContent
          initialObsmKey={host.config.obsmKey}
          initialColorByColumn={host.config.colorByColumn}
          onCreateCheckpoint={() => services.createCheckpoint(host)}
          toolbarTarget={services.bodyHeaderElement(host)}
        />
      </ScatterProvider>
    );
  };
}
