/**
 * DeviceBroker (PLUGIN-ARCHITECTURE §7.1) — the core-visible wrapper over the
 * low-level `device-manager.ts` refcount. It is the ONLY caller of
 * acquire/releaseDevice and exposes `liveLeases()` so `openPlugin` can enforce
 * `meta.maxInstances` truthfully (decision #4).
 *
 * Phase 0: a thin, faithful wrapper that tracks leases by `instanceId` and makes
 * release idempotent. The full AbortSignal-aware acquire that fixes the
 * "device born ownerless" leak (§7.2) is a Phase-2 rework of `device-manager.ts`
 * itself; here we honor an already-aborted signal and release on abort, but do
 * not yet thread cancellation into the in-flight refcount path.
 */

import { acquireDevice, type DeviceInfo, deviceRefCount, releaseDevice } from "@/scatter-gpu/gpu/device-manager";
import type { PluginInstanceId } from "@/core/plugin/host";

export interface DeviceLease {
  /** Lease id, tied to the owning instance. */
  readonly id: string;
  readonly info: DeviceInfo;
  /** Idempotent; decrements the underlying refcount exactly once. */
  release(): void;
}

export interface DeviceBroker {
  /**
   * AbortSignal-aware acquire (`host.signal`). Phase 2 will make aborting a
   * pending init reject AND undo the refcount; Phase 0 honors a pre-aborted
   * signal and releases the lease if the signal fires after acquisition.
   */
  acquire(instanceId: PluginInstanceId, signal?: AbortSignal): Promise<DeviceLease>;
  /** Live lease count — what `openPlugin` reads to enforce `maxInstances`. */
  liveLeases(): number;
  /** Force-release an instance's lease on teardown (idempotent). */
  releaseFor(instanceId: PluginInstanceId): void;
}

export function createDeviceBroker(): DeviceBroker {
  const leases = new Map<PluginInstanceId, DeviceLease>();

  function releaseFor(instanceId: PluginInstanceId): void {
    const lease = leases.get(instanceId);
    if (!lease) return;
    leases.delete(instanceId);
    releaseDevice();
  }

  return {
    async acquire(instanceId, signal) {
      if (signal?.aborted) throw new DOMException("device acquire aborted", "AbortError");

      const info = await acquireDevice();

      // The instance was torn down while the device was initializing — release
      // immediately so we don't strand a lease. (§7.2 will make this airtight.)
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
