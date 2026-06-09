/**
 * GpuDeviceContext (PLUGIN-ARCHITECTURE §7.1, §10.1) — a small React layer over
 * the core `DeviceBroker`, modeled on `@typegpu/react`'s `<Root>` / `useRoot()`
 * ergonomics but adapted to OUR needs. `@typegpu/react` hides disposal,
 * AbortSignal cancellation, and lease accounting; we keep all three (the broker's
 * `liveLeases()` feeds `openPlugin`'s `maxInstances` cap, `host.signal` cancels a
 * pending init, and `host.dispose` owns deterministic release), so it is NOT a
 * drop-in — we wrap the broker instead.
 *
 * Deliberately NON-suspending: a scatter panel's chrome (overlay controls,
 * legend) renders immediately while the device initializes, matching the
 * always-mounted-canvas / async-init invariant of `ScatterGPUHost`. Acquisition
 * errors are surfaced through the GPU host's existing `onGpuError` path so the
 * inline overlay keeps the helpful HPC/Vulkan message — no panel-replacing error
 * boundary, no dead Retry button.
 */

import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from "react";
import { useOptionalHost } from "@/core/host/host-context";
import type { DeviceLease } from "./device-broker";

/**
 * Discriminated lease state read by the GPU host via `useDeviceLease()`:
 *  - `{ managed: false }` — no host on context (the floating/host-less path). The
 *    GPU host self-acquires the shared device exactly as before.
 *  - `{ managed: true, lease: null, error: null }` — a host is present and the
 *    lease is still in flight; the GPU host MUST wait (it must not self-acquire,
 *    or the device refcount would be double-incremented for one instance).
 *  - `{ managed: true, lease }` — the lease resolved; pass it to `createScatterplot`.
 *  - `{ managed: true, error }` — acquisition failed (e.g. WebGPU unsupported);
 *    the GPU host routes it to `onGpuError`.
 */
export type DeviceLeaseState =
  | { readonly managed: false }
  | { readonly managed: true; readonly lease: DeviceLease | null; readonly error: Error | null };

const UNMANAGED: DeviceLeaseState = { managed: false };

const GpuDeviceContext = createContext<DeviceLeaseState>(UNMANAGED);

/**
 * Acquires the current instance's device lease via `host.acquireDeviceLease()`
 * (idempotent; release is owned by `host.dispose`, so this provider never
 * releases) and exposes it as `DeviceLeaseState`. With no host on context it
 * provides `{ managed: false }` and the GPU host falls back to self-acquire.
 *
 * Mount this around ONLY the GPU-host subtree (below scatter's "no embedding"
 * guard) so an idle/empty scatter acquires zero device and sibling chrome is not
 * gated on device init.
 */
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

/** Read the instance's device-lease state. See {@link DeviceLeaseState}. */
// eslint-disable-next-line react/only-export-components
export function useDeviceLease(): DeviceLeaseState {
  return useContext(GpuDeviceContext);
}
