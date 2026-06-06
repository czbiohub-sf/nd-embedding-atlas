/**
 * HostContext (PLUGIN-ARCHITECTURE §4.3, §10.1) — puts the per-instance
 * `PluginHost` on React context so a plugin's deep subtree (e.g. `ScatterContent`
 * → `ScatterView` → `ScatterGPUHost`) can read `host.*` without prop-drilling.
 *
 * `PluginMount` builds one host per instance and passes it as a prop to the
 * plugin's view Component; that Component (e.g. `ScatterPluginView`) wraps its
 * body in `<HostProvider host={host}>`. This is the seam through which the
 * Phase-2b conversion replaces `useDashboard()` + direct store touches with
 * `host.*`, one consumer at a time.
 *
 * The context defaults to `null` so container paths that have no host yet
 * (the floating-scatter window, which renders `ScatterContent` directly, never
 * through `PluginMount`) read `null` and degrade gracefully — they keep their
 * legacy direct-store behavior until they too gain a host.
 */

import { createContext, type ReactNode, useContext } from "react";
import type { PluginHost } from "@/core/plugin/host";

const HostContext = createContext<PluginHost | null>(null);

export interface HostProviderProps {
  host: PluginHost;
  children: ReactNode;
}

export function HostProvider({ host, children }: HostProviderProps) {
  return <HostContext value={host}>{children}</HostContext>;
}

/** Read the current plugin host, or `null` when rendered outside a host (e.g. the floating-scatter path). */
// eslint-disable-next-line react/only-export-components
export function useOptionalHost(): PluginHost | null {
  return useContext(HostContext);
}

/** Read the current plugin host; throws if rendered outside a `<HostProvider>`. */
// eslint-disable-next-line react/only-export-components
export function useHost(): PluginHost {
  const host = useContext(HostContext);
  if (!host) throw new Error("useHost must be used within a <HostProvider>");
  return host;
}
