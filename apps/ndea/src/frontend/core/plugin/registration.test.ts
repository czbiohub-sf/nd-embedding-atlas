import { describe, expect, test } from "bun:test";
import { defineNode, exactNodeTypeRef, type PluginFactory } from "@ndea/sdk";
import { NATIVE_NODE_SOURCE, collectPluginContribution, disposePluginContributions } from "./registration";

function definition(id: string) {
  return defineNode({
    ref: exactNodeTypeRef(id, "1.0.0"),
    title: id,
    role: "transform",
    inputs: [],
    outputs: [],
    capabilities: [] as const,
  });
}

describe("plugin contribution collection", () => {
  test("collects each factory into an isolated source-aware batch", async () => {
    const first = definition("first");
    const second = definition("second");
    const firstBatch = await collectPluginContribution(NATIVE_NODE_SOURCE, ({ registerNode }) => registerNode(first));
    const secondBatch = await collectPluginContribution(NATIVE_NODE_SOURCE, ({ registerNode }) => registerNode(second));

    expect(firstBatch.source).toEqual(NATIVE_NODE_SOURCE);
    expect(firstBatch.definitions).toEqual([first]);
    expect(secondBatch.definitions).toEqual([second]);
    expect(firstBatch.definitions).not.toBe(secondBatch.definitions);
    expect(Object.isFrozen(firstBatch.definitions)).toBe(true);
  });

  test("waits for asynchronous setup before closing registration", async () => {
    const value = definition("async");
    const factory: PluginFactory = async ({ registerNode }) => {
      await Promise.resolve();
      registerNode(value);
    };

    const batch = await collectPluginContribution(NATIVE_NODE_SOURCE, factory);
    expect(batch.definitions).toEqual([value]);
  });

  test("discards a factory's partial collection when setup fails", async () => {
    await expect(
      collectPluginContribution(NATIVE_NODE_SOURCE, ({ registerNode }) => {
        registerNode(definition("partial"));
        throw new Error("setup failed");
      }),
    ).rejects.toThrow("setup failed");

    const next = await collectPluginContribution(NATIVE_NODE_SOURCE, () => {});
    expect(next.definitions).toEqual([]);
  });

  test("runs every disposer in reverse order and reports disposal failures afterward", async () => {
    const calls: string[] = [];
    const batch = (name: string, fail = false) =>
      collectPluginContribution(NATIVE_NODE_SOURCE, () => () => {
        calls.push(name);
        if (fail) throw new Error(name);
      });

    const batches = await Promise.all([batch("first", true), batch("second"), batch("third", true)]);
    expect(() => disposePluginContributions(batches)).toThrow(AggregateError);
    expect(calls).toEqual(["third", "second", "first"]);
  });
});
