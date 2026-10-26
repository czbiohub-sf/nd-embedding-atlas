/** Process-wide, reference-counted GPU leases keyed by dashboard element. */

import { acquireDevice, type DeviceInfo, deviceRefCount, releaseDevice } from "@/core/gpu/device-manager";

export interface DeviceLease {
  readonly id: string;
  readonly info: DeviceInfo;
  release(): void;
}

export interface DeviceBroker {
  acquire(elementId: string, signal?: AbortSignal): Promise<DeviceLease>;
  liveLeases(): number;
  releaseFor(elementId: string): void;
}

function createDeviceBroker(): DeviceBroker {
  const leases = new Map<string, DeviceLease>();

  function releaseFor(elementId: string): void {
    const lease = leases.get(elementId);
    if (!lease) return;
    leases.delete(elementId);
    releaseDevice();
  }

  return {
    async acquire(elementId, signal) {
      if (signal?.aborted) throw new DOMException("device acquire aborted", "AbortError");

      const info = await acquireDevice(signal);

      // Defensive: if the signal fired in the window between acquireDevice
      // resolving and us registering the lease, release immediately.
      if (signal?.aborted) {
        releaseDevice();
        throw new DOMException("device acquire aborted", "AbortError");
      }

      let released = false;
      const lease: DeviceLease = {
        id: elementId,
        info,
        release() {
          if (released) return;
          released = true;
          if (leases.get(elementId) === lease) leases.delete(elementId);
          releaseDevice();
        },
      };
      leases.set(elementId, lease);
      signal?.addEventListener("abort", () => lease.release(), { once: true });
      return lease;
    },

    liveLeases() {
      // Direct scatter instances also increment the shared device refcount.
      return Math.max(deviceRefCount(), leases.size);
    },

    releaseFor,
  };
}

export const deviceBroker: DeviceBroker = createDeviceBroker();
