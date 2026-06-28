/**
 * DeviceBroker (PLUGIN-ARCHITECTURE §7.1) — the core-visible wrapper over the
 * low-level `device-manager.ts` refcount. It is the ONLY caller of
 * acquire/releaseDevice and exposes `liveLeases()` so `openPlugin` can enforce
 * `meta.maxInstances` truthfully (decision #4).
 *
 * A thin, faithful wrapper that tracks leases by `instanceId` and makes release
 * idempotent. `acquire` is AbortSignal-aware end to end: it forwards `host.signal`
 * into `device-manager`'s §7.2-complete refcount path, so aborting a pending init
 * both rejects and undoes the increment — no "device born ownerless" leak.
 */

import { acquireDevice, type DeviceInfo, deviceRefCount, releaseDevice } from "@/core/gpu/device-manager";
import type { NodeInstanceId } from "@/core/node/host";

export interface DeviceLease {
  /** Lease id, tied to the owning instance. */
  readonly id: string;
  readonly info: DeviceInfo;
  /** Idempotent; decrements the underlying refcount exactly once. */
  release(): void;
}

export interface DeviceBroker {
  /**
   * AbortSignal-aware acquire (`host.signal`). Aborting a pending init rejects
   * the promise AND undoes the refcount increment (forwarded into
   * `device-manager`'s §7.2 path), so no device is born ownerless.
   */
  acquire(instanceId: NodeInstanceId, signal?: AbortSignal): Promise<DeviceLease>;
  /** Live lease count — what `openPlugin` reads to enforce `maxInstances`. */
  liveLeases(): number;
  /** Force-release an instance's lease on teardown (idempotent). */
  releaseFor(instanceId: NodeInstanceId): void;
}

export function createDeviceBroker(): DeviceBroker {
  const leases = new Map<NodeInstanceId, DeviceLease>();

  function releaseFor(instanceId: NodeInstanceId): void {
    const lease = leases.get(instanceId);
    if (!lease) return;
    leases.delete(instanceId);
    releaseDevice();
  }

  return {
    async acquire(instanceId, signal) {
      if (signal?.aborted) throw new DOMException("device acquire aborted", "AbortError");

      // Thread the signal into the refcount path: device-manager's acquire is
      // AbortSignal-aware end to end (§7.2 — undoes its own increment and never
      // strands a device if aborted mid-init), so a fast add/delete cannot leak
      // a live ownerless device. acquireDevice throws AbortError on abort.
      const info = await acquireDevice(signal);

      // Defensive: if the signal fired in the window between acquireDevice
      // resolving and us registering the lease, release immediately.
      if (signal?.aborted) {
        releaseDevice();
        throw new DOMException("device acquire aborted", "AbortError");
      }

      let released = false;
      const lease: DeviceLease = {
        id: instanceId,
        info,
        release() {
          if (released) return;
          released = true;
          // Only decrement if this lease is still the registered one.
          if (leases.get(instanceId) === lease) leases.delete(instanceId);
          releaseDevice();
        },
      };
      leases.set(instanceId, lease);
      signal?.addEventListener("abort", () => lease.release(), { once: true });
      return lease;
    },

    liveLeases() {
      // The authoritative count is the shared device refcount — it includes
      // every live scatter instance, whether it acquired via this broker
      // (Phase 2b) or directly through createScatterplot (today). Falls back to
      // the broker's own lease map if larger (defensive).
      return Math.max(deviceRefCount(), leases.size);
    },

    releaseFor,
  };
}

/** Process-wide broker — one GPU device is shared across all instances. */
export const deviceBroker: DeviceBroker = createDeviceBroker();
