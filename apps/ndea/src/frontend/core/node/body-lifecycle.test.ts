import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { nodeInstanceId, type MountedNodeBody, type NodeHost } from "@ndea/sdk";
import { nonReactBodyFixture } from "./non-react-body.fixture";

class FixtureElement {
  readonly children: FixtureElement[] = [];
  readonly dataset: Record<string, string> = {};
  className = "";
  textContent: string | null = null;
  parent: FixtureElement | null = null;
  removeCalls = 0;

  appendChild(child: FixtureElement): FixtureElement {
    if (child.parent) {
      child.parent.children.splice(child.parent.children.indexOf(child), 1);
    }
    child.parent = this;
    this.children.push(child);
    return child;
  }

  remove(): void {
    this.removeCalls += 1;
    if (!this.parent) return;
    this.parent.children.splice(this.parent.children.indexOf(this), 1);
    this.parent = null;
  }
}

const originalDocument = globalThis.document;
const reactRoots = new Map<FixtureElement, { renders: number; unmounts: number }>();

mock.module("react-dom/client", () => ({
  createRoot(element: FixtureElement) {
    const state = { renders: 0, unmounts: 0 };
    reactRoots.set(element, state);
    return {
      render() {
        state.renders += 1;
      },
      unmount() {
        state.unmounts += 1;
      },
    };
  },
}));

beforeAll(() => {
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      createElement: () => new FixtureElement(),
    },
  });
});

afterAll(() => {
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: originalDocument,
  });
  mock.restore();
});

const host = {
  instanceId: nodeInstanceId("body-fixture"),
} as unknown as NodeHost;

function expectOneBodyAdoption(body: MountedNodeBody): void {
  const firstSocket = new FixtureElement();
  const secondSocket = new FixtureElement();
  const element = body.element as unknown as FixtureElement;

  firstSocket.appendChild(element);
  expect(firstSocket.children).toEqual([element]);
  secondSocket.appendChild(element);
  expect(firstSocket.children).toEqual([]);
  expect(secondSocket.children).toEqual([element]);
  expect(element).toBe(body.element as unknown as FixtureElement);

  body.dispose();
  body.dispose();
  expect(secondSocket.children).toEqual([]);
  expect(element.removeCalls).toBe(1);
}

describe("framework-neutral Body lifecycle", () => {
  test("a built-in React Body adopts one element and disposes once", async () => {
    const { countPlotDefinition } = await import("@/nodes/charts/count-plot/plugin");
    const module = await countPlotDefinition.load!();
    const body = await module.mountBody!(host as never);
    const element = body.element as unknown as FixtureElement;

    expect(reactRoots.get(element)).toEqual({ renders: 1, unmounts: 0 });
    expectOneBodyAdoption(body);
    expect(reactRoots.get(element)).toEqual({ renders: 1, unmounts: 1 });
  });

  test("a non-React fixture follows the same adoption and idempotent disposal contract", async () => {
    const body = await nonReactBodyFixture.mountBody!(host);
    expect((body.element as unknown as FixtureElement).dataset.instanceId).toBe("body-fixture");
    expectOneBodyAdoption(body);
  });
});
