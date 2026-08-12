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
import { MosaicClient, Selection } from "@uwdata/mosaic-core";

import type { AppNodeHostDependencies } from "./host";
import { createAppNodeHost } from "./host";
import { FilterScopeRegistry } from "@/core/coordination/filter-scope-runtime";
import { DatasetDataPublicationRuntime } from "@/core/session/dataset-session";

function hostDependencies(overrides: Partial<AppNodeHostDependencies> = {}): AppNodeHostDependencies {
  const coordinator = (overrides.coordinator ?? {
    connect() {},
    disconnect() {},
    query: () => Promise.resolve([]),
  }) as AppNodeHostDependencies["coordinator"];
  const fetch =
    overrides.fetch ??
    ((() => Promise.resolve(new Response(null, { status: 204 }))) as unknown as typeof globalThis.fetch);
  return {
    coordinator,
    defaultInputPredicate: {} as AppNodeHostDependencies["defaultInputPredicate"],
    table: "dataset",
    metadata: {} as AppNodeHostDependencies["metadata"],
    refreshMetadata: () => Promise.resolve(),
    availableCapabilities: new Set(),
    filterScopes: new FilterScopeRegistry({ coordinator, table: "dataset" }),
    dataPublication: new DatasetDataPublicationRuntime(fetch),
    deviceBroker: {
      acquire: () => Promise.reject(new Error("unexpected device acquire")),
      releaseFor() {},
    },
    fetch,
    ...overrides,
  };
}

const facetDefinition = defineNode({
  ref: exactNodeTypeRef("host-fixture", "1.0.0"),
  title: "Host fixture",
  role: "view",
  inputs: [],
  outputs: [],
  capabilities: ["data-read", "focus-coordination", "ordering-coordination", "gpu-device"] as const,
  config: {
    schema: z.object({ page: z.number() }),
    version: nodeConfigVersion(1),
    defaultValue: { page: 1 },
  },
});

const rowSetDefinition = defineNode({
  ref: exactNodeTypeRef("row-set-fixture", "1.0.0"),
  title: "Row-set fixture",
  role: "view",
  inputs: [],
  outputs: [],
  capabilities: ["data-read", "row-set-publish"] as const,
});

describe("createAppNodeHost", () => {
  test("throws instead of mutating local config when no persistence patch handler exists", () => {
    const definition = defineNode({
      ref: exactNodeTypeRef("configless-fixture", "1.0.0"),
      title: "Configless fixture",
      role: "transform",
      inputs: [],
      outputs: [],
      capabilities: [] as const,
    });
    const handle = createAppNodeHost(hostDependencies(), {
      instanceId: nodeInstanceId("configless-1"),
      definition,
      config: {},
    });

    expect(() => handle.host.patchConfig({ fabricated: true })).toThrow(
      "node host configless-1 does not accept configuration patches",
    );
    expect(handle.host.config).toEqual({});
    handle.dispose();
  });

  test("exposes only granted, implemented facets and routes config plus subscriptions", () => {
    const focusEvents: (RowIndex | null)[] = [];
    const disposalEvents: string[] = [];
    const patches: { page?: number }[] = [];
    const handle = createAppNodeHost(
      hostDependencies({
        availableCapabilities: new Set(["data-read", "focus-coordination", "ordering-coordination"]),
      }),
      {
        instanceId: nodeInstanceId("host-1"),
        definition: facetDefinition,
        config: { page: 1 },
        focus: {
          get: () => focusEvents.at(-1) ?? null,
          set: (value) => focusEvents.push(value),
          subscribe: () => () => disposalEvents.push("focus-off"),
        },
        patchConfig: (patch) => patches.push(patch),
      },
    );
    const host = handle.host;

    expect([...host.capabilities]).toEqual(["data-read", "focus-coordination"]);
    expect("data" in host).toBe(true);
    expect("focus" in host).toBe(true);
    expect("ordering" in host).toBe(false);
    expect("acquireDeviceLease" in host).toBe(false);
    expect("publishPredicate" in host).toBe(false);
    const focusOff = host.focus.subscribe!(() => {});
    host.focus.set(rowIndex(7));
    host.patchConfig({ page: 3 });
    expect(host.config).toEqual({ page: 3 });
    expect(patches).toEqual([{ page: 3 }]);
    expect(focusEvents).toEqual([rowIndex(7)]);

    focusOff();
    handle.dispose();
    handle.dispose();
    expect(disposalEvents).toEqual(["focus-off"]);
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
    const { promise: pendingLease, resolve: resolveLease } = Promise.withResolvers<DeviceLease>();
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

  test("does not delete a row-set publication that was never created", () => {
    const methods: string[] = [];
    const handle = createAppNodeHost(
      hostDependencies({
        availableCapabilities: new Set(["data-read", "row-set-publish"]),
        fetch: ((_input, init) => {
          methods.push(init?.method ?? "GET");
          return Promise.resolve(new Response(null, { status: 204 }));
        }) as typeof globalThis.fetch,
      }),
      {
        instanceId: nodeInstanceId("unpublished-row-set"),
        definition: rowSetDefinition,
        config: {},
      },
    );

    handle.dispose();

    expect(methods).toEqual([]);
  });

  test("calls fetch with the global receiver and deletes a published row set once", async () => {
    const receivers: unknown[] = [];
    const methods: string[] = [];
    const fetcher = function (this: unknown, _input: string | URL | Request, init?: RequestInit): Promise<Response> {
      receivers.push(this);
      const method = init?.method ?? "GET";
      methods.push(method);
      return Promise.resolve(
        method === "POST"
          ? Response.json({ ok: true, table: "sel_row_set_fixture", count: 2 })
          : new Response(null, { status: 204 }),
      );
    } as typeof globalThis.fetch;
    const handle = createAppNodeHost(
      hostDependencies({
        availableCapabilities: new Set(["data-read", "row-set-publish"]),
        fetch: fetcher,
      }),
      {
        instanceId: nodeInstanceId("published-row-set"),
        definition: rowSetDefinition,
        config: {},
      },
    );

    await handle.host.dataAPI.publishRowSet([rowIndex(2), rowIndex(5)]);
    handle.dispose();
    handle.dispose();
    while (methods.length < 2) await Promise.resolve();

    expect(receivers).toEqual([globalThis, globalThis]);
    expect(methods).toEqual(["POST", "DELETE"]);
  });

  test("cleans a row-set publication that completes after host disposal", async () => {
    const pending = Promise.withResolvers<Response>();
    const methods: string[] = [];
    const callbacks: string[] = [];
    const fetcher = ((_input: string | URL | Request, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      methods.push(method);
      return method === "POST" ? pending.promise : Promise.resolve(new Response(null, { status: 204 }));
    }) as typeof globalThis.fetch;
    const handle = createAppNodeHost(
      hostDependencies({
        availableCapabilities: new Set(["data-read", "row-set-publish"]),
        fetch: fetcher,
        dataPublication: new DatasetDataPublicationRuntime(fetcher),
      }),
      {
        instanceId: nodeInstanceId("late-row-set"),
        definition: rowSetDefinition,
        config: {},
        onDataRowSetPublished: () => callbacks.push("published"),
      },
    );

    const publication = handle.host.dataAPI.publishRowSet([rowIndex(2)]);
    handle.dispose();
    pending.resolve(Response.json({ ok: true, table: "sel_late_row_set", count: 1 }));

    await expect(publication).rejects.toHaveProperty("name", "AbortError");
    expect(methods).toEqual(["POST", "DELETE"]);
    expect(callbacks).toEqual([]);
  });

  test("grants supported schema mutation without exposing a service facet", () => {
    const definition = defineNode({
      ref: exactNodeTypeRef("schema-mutation-fixture", "1.0.0"),
      title: "Schema mutation fixture",
      role: "view",
      inputs: [],
      outputs: [],
      capabilities: ["schema-mutation"] as const,
    });
    const handle = createAppNodeHost(
      hostDependencies({
        availableCapabilities: new Set(["schema-mutation"]),
      }),
      {
        instanceId: nodeInstanceId("schema-mutation-1"),
        definition,
        config: {},
      },
    );

    expect([...handle.host.capabilities]).toEqual(["schema-mutation"]);
    handle.dispose();
  });

  test("gates exact filter API and delegates client association", () => {
    const definition = defineNode({
      ref: exactNodeTypeRef("filter-fixture", "1.0.0"),
      title: "Filter fixture",
      role: "view",
      inputs: [],
      outputs: [],
      capabilities: ["filter-coordination"] as const,
    });
    const selection = Selection.crossfilter();
    const associated: string[] = [];
    const filter = {
      selection,
      getResolved: () => ({ predicate: null, revision: 0 }),
      subscribeResolved: () => () => {},
      publish() {},
      clear() {},
      associateClient: () => associated.push("associate"),
      disassociateClient: () => associated.push("disassociate"),
      materializeRowIds: async () => ({ rowIds: [], revision: 0 }),
    };
    const handle = createAppNodeHost(hostDependencies({ availableCapabilities: new Set(["filter-coordination"]) }), {
      instanceId: nodeInstanceId("filter-1"),
      definition,
      config: {},
      filter,
    });
    const client = new MosaicClient(selection);

    expect(handle.host.filter.selection).toBe(selection);
    handle.host.filter.associateClient(client);
    handle.host.filter.disassociateClient(client);
    handle.dispose();
    expect(associated).toEqual(["associate", "disassociate"]);
  });

  test("does not expose host.filter when capability is unavailable", () => {
    const definition = defineNode({
      ref: exactNodeTypeRef("filter-unavailable", "1.0.0"),
      title: "Unavailable filter",
      role: "view",
      inputs: [],
      outputs: [],
      capabilities: ["filter-coordination"] as const,
    });
    const handle = createAppNodeHost(hostDependencies(), {
      instanceId: nodeInstanceId("filter-unavailable"),
      definition,
      config: {},
    });
    expect("filter" in handle.host).toBe(false);
    expect(handle.host.capabilities.has("filter-coordination")).toBe(false);
    handle.dispose();
  });

  test("rolls back filter association when client connection fails", () => {
    const definition = defineNode({
      ref: exactNodeTypeRef("filter-connect-failure", "1.0.0"),
      title: "Filter connect failure",
      role: "view",
      inputs: [],
      outputs: [],
      capabilities: ["data-read", "filter-coordination"] as const,
    });
    const selection = Selection.crossfilter();
    const events: string[] = [];
    const filter = {
      selection,
      getResolved: () => ({ predicate: null, revision: 0 }),
      subscribeResolved: () => () => {},
      publish() {},
      clear() {},
      associateClient: () => events.push("associate"),
      disassociateClient: () => events.push("disassociate"),
      materializeRowIds: async () => ({ rowIds: [], revision: 0 }),
    };
    const handle = createAppNodeHost(
      hostDependencies({
        availableCapabilities: new Set(["data-read", "filter-coordination"]),
        coordinator: {
          connect() {
            throw new Error("connect failed");
          },
          disconnect() {},
          query: () => Promise.resolve([]),
        } as unknown as AppNodeHostDependencies["coordinator"],
      }),
      { instanceId: nodeInstanceId("filter-connect-failure"), definition, config: {}, filter },
    );

    expect(() => handle.host.registerClient(new MosaicClient(selection))).toThrow("connect failed");
    expect(events).toEqual(["associate", "disassociate"]);
    handle.dispose();
  });
});
