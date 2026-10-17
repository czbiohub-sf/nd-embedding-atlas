/**
 * Scatter plugin view (PLUGIN-ARCHITECTURE §10.1).
 *
 * Mounts ScatterContent with its host and session services. The app-provided
 * hooks are bound once here at factory scope so every render calls the same
 * hook; the rest of the panel reads their results from context/props.
 */

import { ScatterContent } from "./ScatterContent";
import type { BodyProps } from "../contracts";
import { ScatterProvider, useFocus } from "./context";
import type { ScatterConfig, ScatterServices } from "./contracts";

export function createScatterView(services: ScatterServices) {
  const { useSession, useFocusedPointMeta } = services;
  return function ScatterPluginView({ host }: BodyProps<ScatterConfig>) {
    const session = useSession();
    const focusedPointMeta = useFocusedPointMeta(useFocus(host));
    return (
      <ScatterProvider host={host} services={services} session={session}>
        <ScatterContent
          initialObsmKey={host.config.obsmKey}
          toolbarTarget={host.bodyHeaderElement}
          focusedPointMeta={focusedPointMeta}
        />
      </ScatterProvider>
    );
  };
}
