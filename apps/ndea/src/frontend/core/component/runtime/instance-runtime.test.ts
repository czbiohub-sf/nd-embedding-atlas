import { describe, expect, test } from "bun:test";
import { defineComponent, type ComponentModule, type MountedBody } from "@ndea/sdk";

import type { AnyComponentDefinition } from "@/core/component/definitions";
import type { HostHandle } from "./host";
import { ComponentRuntime } from "./instance-runtime";

class FixtureElement {
  readonly children: FixtureElement[] = [];
  parent: FixtureElement | null = null;

  appendChild(child: FixtureElement): FixtureElement {
    if (child.parent) child.parent.children.splice(child.parent.children.indexOf(child), 1);
    child.parent = this;
    this.children.push(child);
    return child;
  }

  remove(): void {
    if (!this.parent) return;
    this.parent.children.splice(this.parent.children.indexOf(this), 1);
    this.parent = null;
  }
}

interface Deferred<Value> {
  readonly promise: Promise<Value>;
  resolve(value: Value): void;
}

function deferred<Value>(): Deferred<Value> {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

function definition(load: () => Promise<ComponentModule>): AnyComponentDefinition {
  return defineComponent({
    type: "runtime-fixture",
    title: "Runtime fixture",
    documentation: { summary: "Fixture.", use: "Tests." },
    binds: [],
    load,
  });
}

function hostHandle(onDispose: () => void): HostHandle<unknown> {
  return { host: {} as HostHandle<unknown>["host"], dispose: onDispose };
}

function mountedBody(element: FixtureElement, onDispose: () => void): MountedBody {
  let disposed = false;
  return {
    element: element as unknown as HTMLElement,
    dispose() {
      if (disposed) return;
      disposed = true;
      onDispose();
      element.remove();
    },
  };
}

describe("ComponentRuntime", () => {
  test("loads, creates one host and Body, and preserves the Body through adoption", async () => {
    const events: string[] = [];
    const startupEvents: string[] = [];
    const element = new FixtureElement();
    const dock = new FixtureElement();
    const firstSocket = new FixtureElement();
    const secondSocket = new FixtureElement();
    let loads = 0;
    let hosts = 0;
    let mounts = 0;
    const value = definition(() => {
      loads += 1;
      startupEvents.push("module");
      return Promise.resolve({
        mountBody: () => {
          mounts += 1;
          startupEvents.push("body");
          return mountedBody(element, () => events.push("body"));
        },
      });
    });
    const runtime = new ComponentRuntime({
      definition: value,
      dockElement: dock as unknown as HTMLElement,
      createHost: () => {
        hosts += 1;
        startupEvents.push("host");
        return hostHandle(() => events.push("host"));
      },
    });

    const firstStart = runtime.start();
    const secondStart = runtime.start();
    expect(firstStart).toBe(secondStart);
    expect(runtime.getSnapshot().status).toBe("loading");
    await firstStart;
    expect(runtime.getSnapshot()).toEqual({ status: "ready", element: element as unknown as HTMLElement });
    expect({ loads, hosts, mounts }).toEqual({ loads: 1, hosts: 1, mounts: 1 });
    expect(startupEvents).toEqual(["module", "host", "body"]);
    expect(dock.children).toEqual([element]);

    firstSocket.appendChild(dock);
    expect(dock.children).toEqual([element]);
    secondSocket.appendChild(dock);
    await runtime.start();
    expect(firstSocket.children).toEqual([]);
    expect(secondSocket.children).toEqual([dock]);
    expect(dock.children).toEqual([element]);
    expect({ loads, hosts, mounts }).toEqual({ loads: 1, hosts: 1, mounts: 1 });

    runtime.dispose();
    runtime.dispose();
    expect(events).toEqual(["body", "host"]);
    expect(runtime.getSnapshot()).toEqual({ status: "disposed" });
  });

  test("keeps an import failure stable until explicit retry", async () => {
    let loads = 0;
    const element = new FixtureElement();
    const value = definition(() => {
      loads += 1;
      return loads === 1
        ? Promise.reject(new Error("import failed"))
        : Promise.resolve({ mountBody: () => mountedBody(element, () => {}) });
    });
    const runtime = new ComponentRuntime({
      definition: value,
      dockElement: new FixtureElement() as unknown as HTMLElement,
      createHost: () => hostHandle(() => {}),
    });

    await runtime.start();
    const failed = runtime.getSnapshot();
    expect(failed).toMatchObject({ status: "failed", stage: "module", error: { message: "import failed" } });
    await runtime.start();
    expect(runtime.getSnapshot()).toBe(failed);
    expect(loads).toBe(1);

    await runtime.retry();
    expect(runtime.getSnapshot().status).toBe("ready");
    expect(loads).toBe(2);
    runtime.dispose();
  });

  test("keeps a mount failure stable and recreates the failed attempt only on retry", async () => {
    let loads = 0;
    let mounts = 0;
    let hosts = 0;
    let hostDisposals = 0;
    const value = definition(() => {
      loads += 1;
      return Promise.resolve({
        mountBody: () => {
          mounts += 1;
          if (mounts === 1) throw new Error("mount failed");
          return mountedBody(new FixtureElement(), () => {});
        },
      });
    });
    const runtime = new ComponentRuntime({
      definition: value,
      dockElement: new FixtureElement() as unknown as HTMLElement,
      createHost: () => {
        hosts += 1;
        return hostHandle(() => {
          hostDisposals += 1;
        });
      },
    });

    await runtime.start();
    expect(runtime.getSnapshot()).toMatchObject({ status: "failed", stage: "body" });
    expect({ loads, mounts, hosts, hostDisposals }).toEqual({ loads: 1, mounts: 1, hosts: 1, hostDisposals: 1 });
    await runtime.start();
    expect({ loads, mounts, hosts, hostDisposals }).toEqual({ loads: 1, mounts: 1, hosts: 1, hostDisposals: 1 });

    await runtime.retry();
    expect(runtime.getSnapshot().status).toBe("ready");
    expect({ loads, mounts, hosts, hostDisposals }).toEqual({ loads: 2, mounts: 2, hosts: 2, hostDisposals: 1 });
    runtime.dispose();
    expect(hostDisposals).toBe(2);
  });

  test("rejects malformed loaded module data before host construction", async () => {
    let hosts = 0;
    const value = definition(() => Promise.resolve({ mountBody: "not callable" } as never));
    const runtime = new ComponentRuntime({
      definition: value,
      dockElement: new FixtureElement() as unknown as HTMLElement,
      createHost: () => {
        hosts += 1;
        return hostHandle(() => {});
      },
    });

    await runtime.start();
    expect(runtime.getSnapshot()).toMatchObject({
      status: "failed",
      stage: "module",
      error: { message: "component runtime-fixture load did not return a module with mountBody" },
    });
    expect(hosts).toBe(0);
  });

  test("disposes late Body completion immediately after instance disposal", async () => {
    const pendingBody = deferred<MountedBody>();
    const events: string[] = [];
    const dock = new FixtureElement();
    const element = new FixtureElement();
    const value = definition(() =>
      Promise.resolve({
        mountBody: () => pendingBody.promise,
      }),
    );
    const runtime = new ComponentRuntime({
      definition: value,
      dockElement: dock as unknown as HTMLElement,
      createHost: () => hostHandle(() => events.push("host")),
    });

    const start = runtime.start();
    await Promise.resolve();
    await Promise.resolve();
    runtime.dispose();
    expect(events).toEqual(["host"]);
    pendingBody.resolve(mountedBody(element, () => events.push("late-body")));
    await start;

    expect(events).toEqual(["host", "late-body"]);
    expect(dock.children).toEqual([]);
    expect(runtime.getSnapshot()).toEqual({ status: "disposed" });
  });
});
