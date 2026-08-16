import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from "react";
import type { DeviceLease, NodeHost } from "@ndea/sdk";
import type { ScatterCapabilities, ScatterConfig, ScatterServices } from "./contracts";
export { useNodeFocus } from "../query/useNodeFocus";

export type ScatterHost = NodeHost<ScatterConfig, ScatterCapabilities>;

const HostContext = createContext<ScatterHost | null>(null);
const ServicesContext = createContext<ScatterServices | null>(null);
const DeviceLeaseContext = createContext<{ lease: DeviceLease | null; error: Error | null }>({
  lease: null,
  error: null,
});

export function ScatterProvider({
  host,
  services,
  children,
}: {
  host: ScatterHost;
  services: ScatterServices;
  children: ReactNode;
}) {
  return (
    <HostContext value={host}>
      <ServicesContext value={services}>{children}</ServicesContext>
    </HostContext>
  );
}

export function useScatterHost(): ScatterHost {
  const host = useContext(HostContext);
  if (!host) throw new Error("useScatterHost must be used within ScatterProvider");
  return host;
}

export function useScatterServices(): ScatterServices {
  const services = useContext(ServicesContext);
  if (!services) throw new Error("useScatterServices must be used within ScatterProvider");
  return services;
}

export function ScatterDeviceLeaseProvider({ children }: { children: ReactNode }) {
  const host = useScatterHost();
  const [lease, setLease] = useState<DeviceLease | null>(null);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;
    host.acquireDeviceLease().then(
      (value) => {
        if (!cancelled) setLease(value);
      },
      (reason: unknown) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        if (!cancelled) setError(reason instanceof Error ? reason : new Error(String(reason)));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [host]);

  const value = useMemo(() => ({ lease, error }), [lease, error]);
  return <DeviceLeaseContext value={value}>{children}</DeviceLeaseContext>;
}

export function useScatterDeviceLease() {
  return useContext(DeviceLeaseContext);
}
