/** Makes the current plugin instance's host available to its React subtree. */

import { createContext, type ReactNode, useContext } from "react";
import type { NodeCapability, NodeHost } from "@ndea/sdk";

const HostContext = createContext<NodeHost<unknown, never> | null>(null);

export interface HostProviderProps<Config, Capabilities extends NodeCapability> {
  host: NodeHost<Config, Capabilities>;
  children: ReactNode;
}

export function HostProvider<Config, Capabilities extends NodeCapability>({
  host,
  children,
}: HostProviderProps<Config, Capabilities>) {
  return <HostContext value={host as unknown as NodeHost<unknown, never>}>{children}</HostContext>;
}

// eslint-disable-next-line react/only-export-components
export function useOptionalHost<Config, Capabilities extends NodeCapability>(): NodeHost<Config, Capabilities> | null {
  return useContext(HostContext) as NodeHost<Config, Capabilities> | null;
}

// eslint-disable-next-line react/only-export-components
export function useHost<Config, Capabilities extends NodeCapability>(): NodeHost<Config, Capabilities> {
  const host = useContext(HostContext);
  if (!host) throw new Error("useHost must be used within a <HostProvider>");
  return host as unknown as NodeHost<Config, Capabilities>;
}
