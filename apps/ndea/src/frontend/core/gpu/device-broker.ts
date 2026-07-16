/** Process-wide, reference-counted GPU leases keyed by node instance. */

import { acquireDevice, type DeviceInfo, deviceRefCount, releaseDevice } from "@/core/gpu/device-manager";
import type { NodeInstanceId } from "@ndea/sdk";

export interface DeviceLease {
  readonly id: string;
  readonly info: DeviceInfo;
  release(): void;
}

export interface DeviceBroker {
  acquire(instanceId: NodeInstanceId, signal?: AbortSignal): Promise<DeviceLease>;
  liveLeases(): number;
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
          if (leases.get(instanceId) === lease) leases.delete(instanceId);
          releaseDevice();
        },
      };
      leases.set(instanceId, lease);
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
