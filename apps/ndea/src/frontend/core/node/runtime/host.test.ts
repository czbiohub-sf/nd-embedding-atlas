import { describe, expect, test } from "bun:test";
import {
  defineNode,
  exactNodeTypeRef,
  nodeConfigVersion,
  nodeInstanceId,
  rowIndex,
  type DeviceLease,
  type RowIndex,
} from "@ndea/sdk";
import { z } from "zod";

import type { AppNodeHostDependencies } from "./host";
import { createAppNodeHost } from "./host";

function hostDependencies(overrides: Partial<AppNodeHostDependencies> = {}): AppNodeHostDependencies {
  return {
    coordinator: {
      connect() {},
      disconnect() {},
      query: () => Promise.resolve([]),
    } as unknown as AppNodeHostDependencies["coordinator"],
    defaultInputPredicate: {} as AppNodeHostDependencies["defaultInputPredicate"],
    table: "dataset",
    metadata: {} as AppNodeHostDependencies["metadata"],
    refreshMetadata: () => Promise.resolve(),
    availableCapabilities: new Set(),
    predicateBus: {
      publishPredicate() {},
      makeToken: (table, count) => ({ predicate: table, table, count, token: 1 }),
      disposeInstance() {},
    },
    rowSetBus: {
      publishRowSet() {},
      clear() {},
      disposeFor() {},
    },
    deviceBroker: {
      acquire: () => Promise.reject(new Error("unexpected device acquire")),
      releaseFor() {},
    },
    fetch: (() => Promise.resolve(new Response(null, { status: 204 }))) as unknown as typeof globalThis.fetch,
    ...overrides,
  };
}

const facetDefinition = defineNode({
  ref: exactNodeTypeRef("host-fixture", "1.0.0"),
  title: "Host fixture",
  role: "view",
  inputs: [],
  outputs: [],
  capabilities: [
    "data-read",
    "row-set-subscribe",
    "focus-coordination",
    "ordering-coordination",
    "gpu-device",
  ] as const,
  config: {
    schema: z.object({ page: z.number() }),
    version: nodeConfigVersion(1),
    defaultValue: { page: 1 },
  },
});

describe("createAppNodeHost", () => {
  test("exposes only granted, implemented facets and routes config plus subscriptions", () => {
    let rowSet: readonly RowIndex[] | null = [rowIndex(2)];
    const focusEvents: (RowIndex | null)[] = [];
    const disposalEvents: string[] = [];
    const patches: { page?: number }[] = [];
    const handle = createAppNodeHost(
      hostDependencies({
        availableCapabilities: new Set([
          "data-read",
          "row-set-subscribe",
          "focus-coordination",
          "ordering-coordination",
        ]),
      }),
      {
        instanceId: nodeInstanceId("host-1"),
        definition: facetDefinition,
        config: { page: 1 },
        rowSetInput: {
          externalRowSet: () => rowSet,
          onExternalRowSet(callback) {
            callback(rowSet);
            return () => disposalEvents.push("row-set-off");
          },
        },
        focus: {
          get: () => focusEvents.at(-1) ?? null,
          set: (value) => focusEvents.push(value),
          subscribe: () => () => disposalEvents.push("focus-off"),
        },
        patchConfig: (patch) => patches.push(patch),
      },
    );
    const host = handle.host;

    expect([...host.capabilities]).toEqual(["data-read", "row-set-subscribe", "focus-coordination"]);
    expect("data" in host).toBe(true);
    expect("externalRowSet" in host).toBe(true);
    expect("focus" in host).toBe(true);
    expect("ordering" in host).toBe(false);
    expect("acquireDeviceLease" in host).toBe(false);
    expect("publishPredicate" in host).toBe(false);
    expect(host.externalRowSet()).toEqual([rowIndex(2)]);

    const rowSetOff = host.onExternalRowSet(() => {});
    const focusOff = host.focus.subscribe!(() => {});
    rowSet = [];
    host.focus.set(rowIndex(7));
    host.patchConfig({ page: 3 });
    expect(host.config).toEqual({ page: 3 });
    expect(patches).toEqual([{ page: 3 }]);
    expect(focusEvents).toEqual([rowIndex(7)]);

    rowSetOff();
    focusOff();
    handle.dispose();
    handle.dispose();
    expect(disposalEvents).toEqual(["row-set-off", "focus-off"]);
  });

  test("unwinds tracked resources in reverse and releases one acquired device lease once", async () => {
    const events: string[] = [];
    let released = false;
    const lease: DeviceLease = {
      id: "lease",
      info: {} as DeviceLease["info"],
      release() {
        if (released) return;
        released = true;
        events.push("device");
      },
    };
    const definition = defineNode({
      ref: exactNodeTypeRef("gpu-fixture", "1.0.0"),
      title: "GPU fixture",
      role: "view",
      inputs: [],
      outputs: [],
      capabilities: ["gpu-device"] as const,
    });
    const handle = createAppNodeHost(
      hostDependencies({
        availableCapabilities: new Set(["gpu-device"]),
        deviceBroker: {
          acquire: () => Promise.resolve(lease),
          releaseFor: () => events.push("release-for"),
        },
      }),
      {
        instanceId: nodeInstanceId("gpu-1"),
        definition,
        config: {},
      },
    );
    handle.host.onDispose(() => events.push("first"));
    handle.host.onDispose(() => events.push("second"));
    expect(await handle.host.acquireDeviceLease()).toBe(lease);

    handle.dispose();
    handle.dispose();
    expect(events).toEqual(["second", "first", "device"]);
  });

  test("releases a device lease that completes after host disposal", async () => {
    const events: string[] = [];
    let resolveLease!: (lease: DeviceLease) => void;
    const pendingLease = new Promise<DeviceLease>((resolve) => {
      resolveLease = resolve;
    });
    const definition = defineNode({
      ref: exactNodeTypeRef("late-gpu-fixture", "1.0.0"),
      title: "Late GPU fixture",
      role: "view",
      inputs: [],
      outputs: [],
      capabilities: ["gpu-device"] as const,
    });
    const handle = createAppNodeHost(
      hostDependencies({
        availableCapabilities: new Set(["gpu-device"]),
        deviceBroker: {
          acquire: () => pendingLease,
          releaseFor: () => events.push("release-pending"),
        },
      }),
      {
        instanceId: nodeInstanceId("late-gpu-1"),
        definition,
        config: {},
      },
    );
    const acquiring = handle.host.acquireDeviceLease();
    handle.dispose();
    resolveLease({
      id: "late-lease",
      info: {} as DeviceLease["info"],
      release: () => events.push("late-device"),
    });

    await expect(acquiring).rejects.toMatchObject({ name: "AbortError" });
    expect(events).toEqual(["release-pending", "late-device"]);
  });
});
