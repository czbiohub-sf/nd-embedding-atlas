/** Makes the current plugin instance's host available to its React subtree. */

import { createContext, type ReactNode, useContext } from "react";
import type { NodeHost } from "@ndea/sdk";

const HostContext = createContext<NodeHost | null>(null);

export interface HostProviderProps {
  host: NodeHost;
  children: ReactNode;
}

export function HostProvider({ host, children }: HostProviderProps) {
  return <HostContext value={host}>{children}</HostContext>;
}

// eslint-disable-next-line react/only-export-components
export function useOptionalHost(): NodeHost | null {
  return useContext(HostContext);
}

// eslint-disable-next-line react/only-export-components
export function useHost(): NodeHost {
  const host = useContext(HostContext);
  if (!host) throw new Error("useHost must be used within a <HostProvider>");
  return host;
}
