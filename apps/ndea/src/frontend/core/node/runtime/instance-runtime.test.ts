import { describe, expect, test } from "bun:test";
import { defineNode, exactNodeTypeRef, type MountedNodeBody, type NodeCapability, type NodeModule } from "@ndea/sdk";

import type { NodeCatalog } from "@/core/plugin/catalog";
import type { CatalogNodeDefinition } from "@/core/plugin/registration";
import type { HostHandle } from "./host";
import { NodeInstanceRuntime } from "./instance-runtime";

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

function definition(
  load: () => Promise<NodeModule>,
  capabilities: readonly NodeCapability[] = [],
): CatalogNodeDefinition {
  return defineNode({
    ref: exactNodeTypeRef("runtime-fixture", "1.0.0"),
    title: "Runtime fixture",
    role: "view",
    inputs: [],
    outputs: [],
    capabilities,
    load,
  }) as unknown as CatalogNodeDefinition;
}

function catalogWith(value: CatalogNodeDefinition): NodeCatalog {
  return { resolveExact: () => value } as unknown as NodeCatalog;
}

function hostHandle(capabilities: readonly NodeCapability[], onDispose: () => void): HostHandle<unknown> {
  return {
    host: { capabilities: new Set(capabilities) } as HostHandle<unknown>["host"],
    dispose: onDispose,
  };
}

function mountedBody(element: FixtureElement, onDispose: () => void): MountedNodeBody {
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

describe("NodeInstanceRuntime", () => {
  test("loads, creates one host/runtime/Body, and preserves the Body through adoption", async () => {
    const events: string[] = [];
    const element = new FixtureElement();
    const dock = new FixtureElement();
    const firstSocket = new FixtureElement();
    const secondSocket = new FixtureElement();
    let loads = 0;
    let hosts = 0;
    let mounts = 0;
    const value = definition(() => {
      loads += 1;
      return Promise.resolve({
        createRuntime: () => ({ dispose: () => events.push("runtime") }),
        mountBody: () => {
          mounts += 1;
          return mountedBody(element, () => events.push("body"));
        },
      });
    });
    const runtime = new NodeInstanceRuntime({
      catalog: catalogWith(value),
      definitionRef: value.ref,
      dockElement: dock as unknown as HTMLElement,
      createHost: () => {
        hosts += 1;
        return hostHandle([], () => events.push("host"));
      },
    });

    const firstStart = runtime.start();
    const secondStart = runtime.start();
    expect(firstStart).toBe(secondStart);
    expect(runtime.getSnapshot().status).toBe("loading");
    await firstStart;
    expect(runtime.getSnapshot()).toEqual({ status: "ready", element: element as unknown as HTMLElement });
    expect({ loads, hosts, mounts }).toEqual({ loads: 1, hosts: 1, mounts: 1 });
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
    expect(events).toEqual(["body", "runtime", "host"]);
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
    const runtime = new NodeInstanceRuntime({
      catalog: catalogWith(value),
      definitionRef: value.ref,
      dockElement: new FixtureElement() as unknown as HTMLElement,
      createHost: () => hostHandle([], () => {}),
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
    const runtime = new NodeInstanceRuntime({
      catalog: catalogWith(value),
      definitionRef: value.ref,
      dockElement: new FixtureElement() as unknown as HTMLElement,
      createHost: () => {
        hosts += 1;
        return hostHandle([], () => {
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

  test("rejects a missing capability before creating module runtime or mounting Body", async () => {
    let runtimeCreates = 0;
    let mounts = 0;
    let hostDisposals = 0;
    const capabilities = ["gpu-device"] as const;
    const value = definition(
      () =>
        Promise.resolve({
          createRuntime: () => {
            runtimeCreates += 1;
            return { dispose() {} };
          },
          mountBody: () => {
            mounts += 1;
            return mountedBody(new FixtureElement(), () => {});
          },
        }),
      capabilities,
    );
    const runtime = new NodeInstanceRuntime({
      catalog: catalogWith(value),
      definitionRef: value.ref,
      dockElement: new FixtureElement() as unknown as HTMLElement,
      createHost: () =>
        hostHandle([], () => {
          hostDisposals += 1;
        }),
    });

    await runtime.start();
    expect(runtime.getSnapshot()).toMatchObject({
      status: "failed",
      stage: "capability",
      error: { message: expect.stringContaining("gpu-device") },
    });
    expect({ runtimeCreates, mounts, hostDisposals }).toEqual({ runtimeCreates: 0, mounts: 0, hostDisposals: 1 });
  });

  test("disposes late Body completion immediately after instance disposal", async () => {
    const pendingBody = deferred<MountedNodeBody>();
    const events: string[] = [];
    const dock = new FixtureElement();
    const element = new FixtureElement();
    const value = definition(() =>
      Promise.resolve({
        createRuntime: () => ({ dispose: () => events.push("runtime") }),
        mountBody: () => pendingBody.promise,
      }),
    );
    const runtime = new NodeInstanceRuntime({
      catalog: catalogWith(value),
      definitionRef: value.ref,
      dockElement: dock as unknown as HTMLElement,
      createHost: () => hostHandle([], () => events.push("host")),
    });

    const start = runtime.start();
    await Promise.resolve();
    await Promise.resolve();
    runtime.dispose();
    expect(events).toEqual(["runtime", "host"]);
    pendingBody.resolve(mountedBody(element, () => events.push("late-body")));
    await start;

    expect(events).toEqual(["runtime", "host", "late-body"]);
    expect(dock.children).toEqual([]);
    expect(runtime.getSnapshot()).toEqual({ status: "disposed" });
  });
});
