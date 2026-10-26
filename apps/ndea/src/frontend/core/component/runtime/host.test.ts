import { describe, expect, test } from "bun:test";
import { rowIndex, type DeviceLease, type RowIndex } from "@ndea/sdk";
import { Selection } from "@uwdata/mosaic-core";

import type { ComponentHostDependencies, HostInit } from "./host";
import { createComponentHost } from "./host";

function hostDependencies(overrides: Partial<ComponentHostDependencies> = {}): ComponentHostDependencies {
  const coordinator = (overrides.coordinator ?? {
    connect() {},
    disconnect() {},
    query: () => Promise.resolve([]),
  }) as ComponentHostDependencies["coordinator"];
  const fetch =
    overrides.fetch ??
    ((() => Promise.resolve(new Response(null, { status: 204 }))) as unknown as typeof globalThis.fetch);
  return {
    coordinator,
    table: "dataset",
    metadata: {} as ComponentHostDependencies["metadata"],
    refreshMetadata: () => Promise.resolve(),
    deviceBroker: {
      acquire: () => Promise.reject(new Error("unexpected device acquire")),
      releaseFor() {},
    },
    fetch,
    ...overrides,
  };
}

const selection = Selection.intersect();

function hostInit<Config>(
  elementId: string,
  config: Config,
  overrides: Partial<HostInit<Config>> = {},
): HostInit<Config> {
  return {
    elementId,
    type: "fixture",
    config,
    predicate: selection,
    focus: { get: () => null, set() {} },
    viewSync: { panX: 0, panY: 0, zoom: 1, linked: false, broadcast() {}, toggleLock() {} },
    ordering: { get: () => null, set() {} },
    colorBy: { linked: false, get: () => null, set() {}, subscribe: () => () => {} },
    filter: {
      selection,
      getResolved: () => ({ predicate: null, revision: 0 }),
      subscribeResolved: () => () => {},
      publish() {},
      facet: () => {},
      clear() {},
      materializeRowIds: async () => ({ rowIds: [], revision: 0 }),
    },
    ...overrides,
  };
}

/** A filter binding that records publishes and clears. */
function recordingFilter(events: unknown[]): HostInit<unknown>["filter"] {
  return {
    ...hostInit("recorder", {}).filter,
    publish: (facet, clause) => events.push(["publish", facet, clause]),
    clear: (facet) => events.push(["clear", facet]),
  };
}

describe("createComponentHost", () => {
  test("throws instead of mutating local config when no persistence patch handler exists", () => {
    const handle = createComponentHost(hostDependencies(), hostInit<Record<string, unknown>>("configless-1", {}));

    expect(() => handle.host.patchConfig({ fabricated: true })).toThrow(
      "component host configless-1 does not accept configuration patches",
    );
    expect(handle.host.config).toEqual({});
    handle.dispose();
  });

  test("routes config patches and tracks service subscriptions until disposal", () => {
    const focusEvents: (RowIndex | null)[] = [];
    const disposalEvents: string[] = [];
    const patches: { page?: number }[] = [];
    const handle = createComponentHost(
      hostDependencies(),
      hostInit(
        "host-1",
        { page: 1 },
        {
          focus: {
            get: () => focusEvents.at(-1) ?? null,
            set: (value) => focusEvents.push(value),
            subscribe: () => () => disposalEvents.push("focus-off"),
          },
          patchConfig: (patch) => patches.push(patch),
        },
      ),
    );
    const host = handle.host;

    expect(host.elementId).toBe("host-1");
    expect(host.type).toBe("fixture");
    expect(host.predicate).toBe(selection);
    expect(host.filter.selection).toBe(selection);
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
    expect(() => host.focus.set(null)).toThrow("component host host-1 is disposed");
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
    const handle = createComponentHost(
      hostDependencies({
        deviceBroker: {
          acquire: () => Promise.resolve(lease),
          releaseFor: () => events.push("release-for"),
        },
      }),
      hostInit("gpu-1", {}),
    );
    const host = handle.host;
    host.onDispose(() => events.push("first"));
    host.onDispose(() => events.push("second"));
    expect(await host.acquireDeviceLease()).toBe(lease);

    handle.dispose();
    handle.dispose();
    expect(events).toEqual(["second", "first", "device"]);
  });

  test("runs every disposer, surfaces failures, and remains idempotent", () => {
    const events: string[] = [];
    const handle = createComponentHost(hostDependencies(), hostInit("failing-disposal", {}));
    handle.host.onDispose(() => {
      events.push("first");
      throw new Error("first failed");
    });
    handle.host.onDispose(() => {
      events.push("second");
      throw new Error("second failed");
    });

    expect(() => handle.dispose()).toThrow("component host failing-disposal disposal failed");
    expect(events).toEqual(["second", "first"]);
    expect(() => handle.dispose()).not.toThrow();
  });

  test("releases a device lease that completes after host disposal", async () => {
    const events: string[] = [];
    const { promise: pendingLease, resolve: resolveLease } = Promise.withResolvers<DeviceLease>();
    const handle = createComponentHost(
      hostDependencies({
        deviceBroker: {
          acquire: () => pendingLease,
          releaseFor: () => events.push("release-pending"),
        },
      }),
      hostInit("late-gpu-1", {}),
    );
    const host = handle.host;
    const acquiring = host.acquireDeviceLease();
    handle.dispose();
    resolveLease({
      id: "late-lease",
      info: {} as DeviceLease["info"],
      release: () => events.push("late-device"),
    });

    await expect(acquiring).rejects.toMatchObject({ name: "AbortError" });
    expect(events).toEqual(["release-pending", "late-device"]);
  });

  test("publishSelection creates the set through POST /api/sets, publishes it, and clears on null", async () => {
    const requests: { receiver: unknown; url: string; body: number[] }[] = [];
    const fetcher = function (this: unknown, input: string, init?: { body?: Uint8Array }): Promise<Response> {
      requests.push({ receiver: this, url: input, body: [...(init?.body ?? [])] });
      return Promise.resolve(Response.json({ set: "0123456789abcdef", count: 2 }));
    } as unknown as typeof globalThis.fetch;
    const events: unknown[] = [];
    const handle = createComponentHost(
      hostDependencies({ fetch: fetcher }),
      hostInit("row-set", {}, { filter: recordingFilter(events) }),
    );
    const host = handle.host;

    // Rows 2 and 5 of 10: one u32 word, sent as ceil(10 / 8) = 2 bytes.
    expect(await host.filter.publishSelection("lasso", new Uint32Array([0b100100]), 10)).toEqual({
      set: "0123456789abcdef",
      count: 2,
    });
    expect(requests).toEqual([{ receiver: globalThis, url: "/api/sets?rows=10", body: [0b100100, 0] }]);
    expect(await host.filter.publishSelection("lasso", null, 10)).toBeNull();
    expect(events).toEqual([
      ["publish", "lasso", { op: "inSet", set: "0123456789abcdef" }],
      ["clear", "lasso"],
    ]);
    handle.dispose();
  });

  test("publishSelection publishes nothing once its signal aborts", async () => {
    const { promise: response, resolve } = Promise.withResolvers<Response>();
    const events: unknown[] = [];
    const handle = createComponentHost(
      hostDependencies({ fetch: (() => response) as unknown as typeof globalThis.fetch }),
      hostInit("superseded", {}, { filter: recordingFilter(events) }),
    );
    const superseded = new AbortController();
    const publishing = handle.host.filter.publishSelection("lasso", new Uint32Array([1]), 1, superseded.signal);
    superseded.abort();
    resolve(Response.json({ set: "0123456789abcdef", count: 1 }));
    expect(await publishing).toBeNull();
    expect(events).toEqual([]);

    const failing = createComponentHost(
      hostDependencies({ fetch: (() => Promise.reject(new Error("aborted"))) as unknown as typeof globalThis.fetch }),
      hostInit("aborted", {}, { filter: recordingFilter(events) }),
    );
    const aborted = new AbortController();
    aborted.abort();
    expect(await failing.host.filter.publishSelection("lasso", new Uint32Array([1]), 1, aborted.signal)).toBeNull();
    expect(events).toEqual([]);
    handle.dispose();
    failing.dispose();
  });

  test("saves a data source through the init handler and refuses without one", () => {
    const saved: [string, unknown][] = [];
    const handle = createComponentHost(
      hostDependencies(),
      hostInit("saver", {}, { saveSource: (base, where) => (saved.push([base, where]), `${base}-1`) }),
    );
    const where = { op: "inSet", set: "0123456789abcdef" } as const;
    expect(handle.host.dataAPI.saveSource("Selection", where)).toBe("Selection-1");
    expect(saved).toEqual([["Selection", where]]);
    handle.dispose();

    const bare = createComponentHost(hostDependencies(), hostInit("bare", {}));
    expect(() => bare.host.dataAPI.saveSource("Selection", where)).toThrow("cannot save data sources");
    bare.dispose();
  });
});
