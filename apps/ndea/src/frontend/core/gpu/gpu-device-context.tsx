/** Non-suspending React access to the current node's GPU lease. */

import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from "react";
import { useOptionalHost } from "@/core/host/host-context";
import type { DeviceLease } from "./device-broker";

/** `managed` prevents host-backed views from self-acquiring while the lease loads. */
export type DeviceLeaseState =
  | { readonly managed: false }
  | { readonly managed: true; readonly lease: DeviceLease | null; readonly error: Error | null };

const UNMANAGED: DeviceLeaseState = { managed: false };

const GpuDeviceContext = createContext<DeviceLeaseState>(UNMANAGED);

export function GpuDeviceProvider({ children }: { children: ReactNode }) {
  const host = useOptionalHost();
  const [lease, setLease] = useState<DeviceLease | null>(null);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!host) return;
    let cancelled = false;
    host
      .acquireDeviceLease()
      .then((l) => {
        if (!cancelled) setLease(l);
      })
      .catch((err: unknown) => {
        // Teardown aborts are expected — only surface real failures.
        if (err instanceof DOMException && err.name === "AbortError") return;
        if (!cancelled) setError(err instanceof Error ? err : new Error(String(err)));
      });
    return () => {
      cancelled = true;
    };
  }, [host]);

  const value = useMemo<DeviceLeaseState>(
    () => (host ? { managed: true, lease, error } : UNMANAGED),
    [host, lease, error],
  );

  return <GpuDeviceContext value={value}>{children}</GpuDeviceContext>;
}

// eslint-disable-next-line react/only-export-components
export function useDeviceLease(): DeviceLeaseState {
  return useContext(GpuDeviceContext);
}
