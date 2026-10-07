/**
 * Scatter plugin view (PLUGIN-ARCHITECTURE §10.1).
 *
 * Mounts ScatterContent with the capability-gated host and session services.
 */

import { ScatterContent } from "./ScatterContent";
import type { NodeBodyProps } from "../contracts";
import { ScatterProvider } from "./context";
import type { ScatterCapabilities, ScatterConfig, ScatterServices } from "./contracts";

export function createScatterView(services: ScatterServices) {
  return function ScatterPluginView({ host }: NodeBodyProps<ScatterConfig, ScatterCapabilities>) {
    return (
      <ScatterProvider host={host} services={services}>
        <ScatterContent initialObsmKey={host.config.obsmKey} toolbarTarget={services.bodyHeaderElement(host)} />
      </ScatterProvider>
    );
  };
}
