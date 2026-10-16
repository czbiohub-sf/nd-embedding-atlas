/**
 * Scatter plugin view (PLUGIN-ARCHITECTURE §10.1).
 *
 * Mounts ScatterContent with its host and session services.
 */

import { ScatterContent } from "./ScatterContent";
import type { BodyProps } from "../contracts";
import { ScatterProvider } from "./context";
import type { ScatterConfig, ScatterServices } from "./contracts";

export function createScatterView(services: ScatterServices) {
  return function ScatterPluginView({ host }: BodyProps<ScatterConfig>) {
    return (
      <ScatterProvider host={host} services={services}>
        <ScatterContent initialObsmKey={host.config.obsmKey} toolbarTarget={host.bodyHeaderElement} />
      </ScatterProvider>
    );
  };
}
